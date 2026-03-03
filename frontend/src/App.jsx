import { useEffect, useMemo, useRef, useState } from "react";

const THEME_STORAGE_KEY = "tmscroll-theme";

function getInitialTheme() {
  if (typeof window === "undefined") return "light";
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

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
  const [theme, setTheme] = useState(getInitialTheme);
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [currentUsername, setCurrentUsername] = useState("");
  const [archiveEntries, setArchiveEntries] = useState([]);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isJournalMenuOpen, setIsJournalMenuOpen] = useState(false);
  const [journalOptions, setJournalOptions] = useState([]);
  const [journalBusy, setJournalBusy] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchBusy, setSearchBusy] = useState(false);

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
  const [cardBlackout, setCardBlackout] = useState(false);
  const [cardStyle, setCardStyle] = useState({ transform: "", opacity: "", transition: "" });

  const [loading, setLoading] = useState(false);
  const [signupSuccessFlash, setSignupSuccessFlash] = useState(false);
  const [addedBubbleVisible, setAddedBubbleVisible] = useState(false);
  const [notTransfusionBusy, setNotTransfusionBusy] = useState(false);

  const currentStudyId = currentStudy?.id || "";

  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const latestDeckCountsRef = useRef({
    total_loaded: 0,
    remaining_in_deck: 0,
    filtered_total_loaded: 0,
    filtered_remaining_in_deck: 0,
  });

  const loadingRef = useRef(false);
  const currentStudyRef = useRef(null);

  const abstractRequestTokenRef = useRef(0);
  const signupFlashTimerRef = useRef(null);
  const addedBubbleTimerRef = useRef(null);
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
  const lastWheelAtRef = useRef(0);

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
    document.documentElement.setAttribute("data-theme", theme);
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      [signupFlashTimerRef, addedBubbleTimerRef, exitTimerRef, enterTimerRef, swipeResetTimerRef].forEach((timerRef) => {
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

  function updateDeckBadge(counts) {
    const totalRaw = Number.isFinite(counts?.total_loaded) ? Number(counts.total_loaded) : 0;
    const remainingRaw = Number.isFinite(counts?.remaining_in_deck) ? Number(counts.remaining_in_deck) : 0;
    const filteredTotalRaw = Number.isFinite(counts?.filtered_total_loaded)
      ? Number(counts.filtered_total_loaded)
      : totalRaw;
    const filteredRemainingRaw = Number.isFinite(counts?.filtered_remaining_in_deck)
      ? Number(counts.filtered_remaining_in_deck)
      : remainingRaw;

    const total = Math.max(0, Math.floor(totalRaw));
    const remaining = Math.max(0, Math.min(total, Math.floor(remainingRaw)));
    const filteredTotal = Math.max(0, Math.min(total, Math.floor(filteredTotalRaw)));
    const filteredRemaining = Math.max(0, Math.min(filteredTotal, Math.floor(filteredRemainingRaw)));

    if (total <= 0) {
      setBadgeText("No studies loaded");
      return;
    }

    if (filteredTotal < total) {
      setBadgeText(`${filteredRemaining} left /${filteredTotal} filtered (of ${total} total)`);
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

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function showAddedBubble() {
    setAddedBubbleVisible(true);
    setTimeoutTracked(addedBubbleTimerRef, () => setAddedBubbleVisible(false), 850);
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
    const exitX = Math.max(window.innerWidth * 1.6, 760);

    setCardStyle({
      transition: "transform 360ms cubic-bezier(0.2, 0.82, 0.2, 1), opacity 360ms ease",
      transform: startTransform,
      opacity: cardStyleRef.current.opacity || "1",
    });

    swipeRafOneRef.current = requestAnimationFrame(() => {
      swipeRafTwoRef.current = requestAnimationFrame(() => {
        setCardStyle({
          transition: "transform 360ms cubic-bezier(0.2, 0.82, 0.2, 1), opacity 360ms ease",
          transform: `translate3d(${exitX}px, 22px, 0px) rotate(16deg)`,
          opacity: "0.02",
        });
      });
    });
  }

  function triggerCardEnter(ms = 340) {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    setCardEnter(true);
    enterTimerRef.current = window.setTimeout(() => {
      enterTimerRef.current = null;
      setCardEnter(false);
    }, ms);
  }

  function animateOutThenIn(direction, updater) {
    resetSwipeVisual();
    setCardFlipped(false);
    setCardExitY(direction === "down" ? "54px" : "-54px");
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
      triggerCardEnter(340);
    }, 240);
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

  function renderHistoryEntry(entry, direction, options = {}) {
    const skipTransition = Boolean(options.skipTransition);
    if (skipTransition) {
      if (!options.keepSwipeVisual) {
        resetSwipeVisual();
      }
      setCardExit(false);
      renderStudy(entry.study);
      if (options.triggerEnter !== false) {
        triggerCardEnter(300);
      }
    } else {
      animateOutThenIn(direction, () => renderStudy(entry.study));
    }

    if (Number.isFinite(entry.total_loaded) && Number.isFinite(entry.remaining_in_deck)) {
      latestDeckCountsRef.current = {
        total_loaded: Number(entry.total_loaded),
        remaining_in_deck: Number(entry.remaining_in_deck),
        filtered_total_loaded: Number.isFinite(entry.filtered_total_loaded)
          ? Number(entry.filtered_total_loaded)
          : Number(entry.total_loaded),
        filtered_remaining_in_deck: Number.isFinite(entry.filtered_remaining_in_deck)
          ? Number(entry.filtered_remaining_in_deck)
          : Number(entry.remaining_in_deck),
      };
    }
    updateDeckBadge(latestDeckCountsRef.current);

    if (entry.message) {
      // Keep runtime feed errors concise in UI; details stay in server logs.
      setStatus("Some feeds failed to refresh. Showing available studies.", true);
    } else {
      setStatus("");
    }
  }

  function showPreviousStudy(direction = "up", options = {}) {
    if (loadingRef.current) return;

    if (historyIndexRef.current <= 0) {
      setStatus("No previous study in this session.");
      return;
    }

    historyIndexRef.current -= 1;
    renderHistoryEntry(historyRef.current[historyIndexRef.current], direction, options);
    logUsage("previous_study", { index: historyIndexRef.current });
  }

  async function showNextStudy(direction = "down", options = {}) {
    if (loadingRef.current) return;

    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current += 1;
      renderHistoryEntry(historyRef.current[historyIndexRef.current], direction, options);
      logUsage("next_study_history", { index: historyIndexRef.current });
      return;
    }

    setLoading(true);
    loadingRef.current = true;
    if (!options.suppressLoadingStatus) {
      setStatus("Loading next study...");
    }

    try {
      const res = await fetch("/api/next");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (!data.ok || !data.study) {
        setCurrentStudy(null);
        updateDeckBadge({
          total_loaded: 0,
          remaining_in_deck: 0,
          filtered_total_loaded: 0,
          filtered_remaining_in_deck: 0,
        });
        setStatus(data.message || "No cached studies available.", true);
        return;
      }

      const entry = {
        study: data.study,
        total_loaded: data.total_loaded,
        remaining_in_deck: data.remaining_in_deck,
        filtered_total_loaded: data.filtered_total_loaded,
        filtered_remaining_in_deck: data.filtered_remaining_in_deck,
        message: data.message || "",
      };

      historyRef.current.push(entry);
      historyIndexRef.current = historyRef.current.length - 1;
      renderHistoryEntry(entry, direction, options);
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
      setJournalOptions([]);
      setIsJournalMenuOpen(false);
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
    setJournalOptions([]);
    setIsJournalMenuOpen(false);
    setStatus("Logged out.");
    logUsage("logout_ui");
  }

  async function addCurrentStudyToArchive() {
    if (!currentUsername) {
      setStatus("Login required to save to personal archive.", true);
      return false;
    }

    const study = currentStudyRef.current;
    if (!study || !study.id) {
      setStatus("No study loaded yet.", true);
      return false;
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
      return false;
    }

    await fetchArchive(currentUsername);
    setStatus("Saved to your personal archive.");
    logUsage("archive_save_ui", { study_id: study.id });
    return true;
  }

  async function archiveSwipeToNextStudy() {
    if (loadingRef.current) return;
    const saved = await addCurrentStudyToArchive();
    if (!saved) {
      resetSwipeVisual();
      return;
    }
    showAddedBubble();
    playArchiveSwipeVisual();
    await delay(360);
    await showNextStudy("up", {
      skipTransition: true,
      keepSwipeVisual: true,
      triggerEnter: false,
      suppressLoadingStatus: true,
    });
    resetSwipeVisual();
    triggerCardEnter(300);
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
    if (notTransfusionBusy) return;

    if (!currentUsername) {
      setStatus("Login required to vote 'Not transfusion'.", true);
      return;
    }

    setNotTransfusionBusy(true);
    try {
      const { res, data } = await apiJson("/api/study/not-transfusion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study_id: study.id }),
      });

      if (!res.ok || !data.ok) {
        setStatus(data.message || "Could not remove study.", true);
        return;
      }

      setStatus(data.message || "Removed from deck.");
      logUsage("not_transfusion_vote_ui", {
        study_id: study.id,
        votes: Number(data.votes || 0),
        excluded: Boolean(data.excluded),
      });

      removeStudyFromHistory(study.id);
      if ((currentStudyRef.current?.id || "") === study.id) {
        setCardFlipped(false);
        setCardBlackout(true);
        await delay(220);
        await showNextStudy("up", {
          skipTransition: true,
          keepSwipeVisual: true,
          triggerEnter: false,
          suppressLoadingStatus: true,
        });
        setCardBlackout(false);
        triggerCardEnter(280);
      }
    } finally {
      setNotTransfusionBusy(false);
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

  function applyJournalSelectionToHistory(journals) {
    const allowed = new Set((journals || []).filter((j) => j.selected).map((j) => j.journal));
    if (!allowed.size) {
      historyRef.current = [];
      historyIndexRef.current = -1;
      return;
    }
    const currentHistoryStudyId =
      historyIndexRef.current >= 0 ? (historyRef.current[historyIndexRef.current]?.study?.id || "") : "";
    const filtered = historyRef.current.filter((entry) => allowed.has(entry?.study?.journal || ""));
    historyRef.current = filtered;
    historyIndexRef.current = filtered.findIndex((entry) => (entry?.study?.id || "") === currentHistoryStudyId);
  }

  async function openJournalMenu() {
    if (!currentUsername) {
      setStatus("Login required to set journal filters.", true);
      return;
    }
    setJournalBusy(true);
    try {
      const { res, data } = await apiJson("/api/journal-filters");
      if (!res.ok || !data.ok) {
        setStatus(data.message || "Could not load journal filters.", true);
        return;
      }
      setJournalOptions(Array.isArray(data.journals) ? data.journals : []);
      setIsJournalMenuOpen(true);
      logUsage("open_journal_filters_ui");
    } finally {
      setJournalBusy(false);
    }
  }

  async function toggleJournalSelection(journalName, nextSelected) {
    if (!journalName || journalBusy) return;
    setJournalBusy(true);
    try {
      const { res, data } = await apiJson("/api/journal-filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journal: journalName, selected: nextSelected }),
      });
      if (!res.ok || !data.ok) {
        setStatus(data.message || "Could not update journal filter.", true);
        return;
      }
      const journals = Array.isArray(data.journals) ? data.journals : [];
      setJournalOptions(journals);
      applyJournalSelectionToHistory(journals);

      const activeJournalSet = new Set(journals.filter((j) => j.selected).map((j) => j.journal));
      if (currentStudyRef.current && !activeJournalSet.has(currentStudyRef.current.journal || "")) {
        await showNextStudy("down", { suppressLoadingStatus: true });
      }
      setStatus("Journal filters updated.");
      logUsage("journal_filter_toggle_ui", { journal: journalName, selected: nextSelected });
    } finally {
      setJournalBusy(false);
    }
  }

  async function setAllJournalSelections(nextSelected) {
    if (journalBusy) return;
    setJournalBusy(true);
    try {
      const { res, data } = await apiJson("/api/journal-filters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all_selected: nextSelected }),
      });
      if (!res.ok || !data.ok) {
        setStatus(data.message || "Could not update all journal filters.", true);
        return;
      }
      const journals = Array.isArray(data.journals) ? data.journals : [];
      setJournalOptions(journals);
      applyJournalSelectionToHistory(journals);

      if (!nextSelected) {
        setCurrentStudy(null);
        setStatus("All journals unchecked.");
      } else {
        setStatus("All journals checked.");
      }
      logUsage("journal_filter_toggle_all_ui", { selected: nextSelected });
    } finally {
      setJournalBusy(false);
    }
  }

  function openSearchPopup() {
    setIsSearchOpen(true);
    logUsage("open_search_popup_ui");
  }

  async function runStudySearch() {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setStatus("Enter at least 2 characters to search.", true);
      return;
    }
    setSearchBusy(true);
    try {
      const { res, data } = await apiJson(`/api/search-studies?q=${encodeURIComponent(q)}&limit=300`);
      if (!res.ok || !data.ok) {
        setStatus(data.message || "Search failed.", true);
        return;
      }
      const results = Array.isArray(data.results) ? data.results : [];
      setSearchResults(results);
      setStatus(`Found ${results.length} matching studies.`);
      logUsage("study_search_ui", { query: q, count: results.length });
    } finally {
      setSearchBusy(false);
    }
  }

  async function copySearchResults() {
    if (!searchResults.length) {
      setStatus("No search results to copy.", true);
      return;
    }
    const body = searchResults
      .map((study, i) => `Result ${i + 1}\n${buildStudyText(study, study.summary || "")}`)
      .join("\n\n----------------------------------------\n\n");
    try {
      await copyTextToClipboard(body);
      setStatus(`Copied ${searchResults.length} search results.`);
      logUsage("copy_search_results_ui", { count: searchResults.length });
    } catch (err) {
      setStatus(`Copy search results failed: ${err.message}`, true);
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
      void archiveSwipeToNextStudy();
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
    if (
      ev.target.closest("#study-link") ||
      ev.target.closest("#not-transfusion-btn") ||
      ev.target.closest("#study-copy-btn")
    ) {
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
    const now = Date.now();
    if (now - lastWheelAtRef.current < 220) return;
    lastWheelAtRef.current = now;
    ev.preventDefault();

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
  const journalFilterButtonLabel = journalBusy ? "..." : "Journals";
  const searchRunButtonLabel = searchBusy ? "Searching..." : "Run Search";
  const darkModeEnabled = theme === "dark";

  const signupButtonClass = useMemo(
    () => `auth-btn${signupSuccessFlash ? " success-flash" : ""}`,
    [signupSuccessFlash]
  );

  const signupButtonLabel = signupSuccessFlash ? "Signed up ✓" : "Sign Up";

  const notTransfusionButtonTitle = !currentStudyId
    ? "Load a study first."
    : notTransfusionBusy
      ? "Removing..."
    : !currentUsername
      ? "Login required to vote."
      : "Report this study as not transfusion-related.";

  const notTransfusionButtonLabel = notTransfusionBusy ? "Removing..." : "Not transfusion";

  const cardClass = [
    "card",
    cardFlipped ? "flipped" : "",
    cardExit ? "exit" : "",
    cardEnter ? "enter" : "",
    cardDragging ? "dragging" : "",
    cardBlackout ? "blackout" : "",
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
      <div className={`added-bubble${addedBubbleVisible ? " show" : ""}`}>Added</div>
      <main className="shell">
        <header className="header">
          <div>
            <h1 className="title">TMScroll Studies</h1>
            <p className="subtitle">Doom scroll the latest in transfusion science</p>
          </div>
          <div className="header-right">
            <button
              className="theme-toggle"
              type="button"
              aria-label={darkModeEnabled ? "Switch to light mode" : "Switch to dark mode"}
              title={darkModeEnabled ? "Light mode" : "Dark mode"}
              onClick={() => {
                setTheme((prev) => (prev === "dark" ? "light" : "dark"));
                logUsage("theme_toggle_ui", { to_theme: darkModeEnabled ? "light" : "dark" });
              }}
            >
              {darkModeEnabled ? "☀" : "☾"}
            </button>
            <div className="badge" id="deck-badge">{badgeText}</div>
          </div>
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
                    disabled={!currentStudyId || notTransfusionBusy}
                    onClick={markCurrentStudyNotTransfusion}
                  >
                    {notTransfusionButtonLabel}
                  </button>
                  <button id="study-copy-btn" className="study-copy-btn" type="button" onClick={copyCurrentStudyInformation}>
                    Copy
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

        <section className="controls nav-controls">
          <button id="prev-btn" className="ctl-btn" type="button" onClick={() => showPreviousStudy("down")}>
            ←
          </button>
          <button id="next-btn" className="ctl-btn" type="button" onClick={() => showNextStudy("down")}>
            →
          </button>
        </section>

        <section className="controls filter-controls">
          <button id="journals-btn" className="ctl-btn" type="button" onClick={openJournalMenu} disabled={journalBusy}>
            {journalFilterButtonLabel}
          </button>
          <button id="search-btn" className="ctl-btn" type="button" onClick={openSearchPopup}>
            Search
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
          <div className="archive-tools">
            <button className="archive-copy-btn" type="button" onClick={() => void copyArchiveListInformation()}>
              Copy List
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

      <section
        className={`archive-panel${isJournalMenuOpen ? " open" : ""}`}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget) setIsJournalMenuOpen(false);
        }}
      >
        <div className="archive-card journal-filter-card">
          <div className="archive-head">
            <span>Journal Filters</span>
            <button className="archive-close" type="button" onClick={() => setIsJournalMenuOpen(false)}>
              Close
            </button>
          </div>
          <div className="journal-filter-help">
            Click to include/exclude journals. Included journals are highlighted.
          </div>
          <div className="journal-filter-actions">
            <button type="button" onClick={() => void setAllJournalSelections(true)} disabled={journalBusy}>
              Check all
            </button>
            <button type="button" onClick={() => void setAllJournalSelections(false)} disabled={journalBusy}>
              Uncheck all
            </button>
          </div>
          <div className="journal-filter-list">
            {!journalOptions.length ? (
              <div className="archive-item">
                <h4>No journal options yet</h4>
                <p>Load studies first, then reopen this menu.</p>
              </div>
            ) : (
              journalOptions.map((item) => {
                const selected = Boolean(item.selected);
                return (
                  <button
                    key={item.journal}
                    type="button"
                    className={`journal-pill${selected ? " selected" : ""}`}
                    onClick={() => toggleJournalSelection(item.journal, !selected)}
                    disabled={journalBusy}
                    title={`${item.count} studies`}
                  >
                    <span>{item.journal}</span>
                    <span>{item.count}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </section>

      <section
        className={`archive-panel${isSearchOpen ? " open" : ""}`}
        onClick={(ev) => {
          if (ev.target === ev.currentTarget) setIsSearchOpen(false);
        }}
      >
        <div className="archive-card search-card">
          <div className="archive-head">
            <span>Search Studies</span>
            <button className="archive-close" type="button" onClick={() => setIsSearchOpen(false)}>
              Close
            </button>
          </div>
          <div className="search-tools">
            <input
              type="text"
              value={searchQuery}
              placeholder="Search studies (case-insensitive substring)"
              onChange={(ev) => setSearchQuery(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault();
                  void runStudySearch();
                }
              }}
            />
            <button type="button" onClick={() => void runStudySearch()} disabled={searchBusy}>
              {searchRunButtonLabel}
            </button>
            <button type="button" onClick={() => void copySearchResults()} disabled={!searchResults.length}>
              Copy All
            </button>
          </div>
          <div className="search-results">
            {!searchResults.length ? (
              <div className="archive-item">
                <h4>No results yet</h4>
                <p>Enter at least 2 characters and run search.</p>
              </div>
            ) : (
              searchResults.map((study, idx) => (
                <div className="archive-item" key={`${study.id || study.link || "search"}-${idx}`}>
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
