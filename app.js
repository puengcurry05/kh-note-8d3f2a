(() => {
  const SHIN_RAW = window.HISTORY_DATA;
  const SONG_RAW = window.SONG_HISTORY_DATA;

  const DATASETS = {
    shin: {
      id: "shin",
      teacherName: "신동필T",
      titleLabel: "신동필T · 수업 자료",
      rangeLabel: "시험 범위 주제 06–10",
      allViewId: "shin-all-topics",
      allViewLabel: "전체 (06–10)",
      topics: SHIN_RAW.topics
    },
    song: {
      id: "song",
      teacherName: "송치중T",
      titleLabel: "송치중T · 교과서",
      rangeLabel: SONG_RAW.rangeLabel || "시험 범위 주제 18–22 (교과서 88~107쪽)",
      allViewId: "song-all-topics",
      allViewLabel: SONG_RAW.allViewLabel || "전체 (18–22)",
      topics: SONG_RAW.topics
    }
  };

  const ALL_TOPICS = [...DATASETS.shin.topics, ...DATASETS.song.topics];
  const STORAGE_KEY = "kh_study_v4";

  const DENSITY_RATIOS = {
    standard: 0.44,
    dense: 0.72,
    all: 1.0,
    read: 0.0
  };

  function loadPersisted() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("kh_study_v3");
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }

  const persisted = loadPersisted();

  function parseHashTeacher() {
    const h = (window.location.hash || "").replace(/^#/, "").trim();
    if (h === "shin" || h === "song") return h;
    return null;
  }

  const state = {
    // null means show the teacher landing screen first
    activeTeacher: parseHashTeacher(),
    activeViewByTeacher: persisted.activeViewByTeacher || {
      shin: persisted.activeView && persisted.activeView.startsWith("topic-") ? persisted.activeView : "topic-06",
      song: "song-18"
    },
    timelineModeByTeacher: persisted.timelineModeByTeacher || {
      shin: persisted.timelineMode || "mixed",
      song: "mixed"
    },
    density: persisted.density || "standard",
    theme: persisted.theme || "light",
    peekAll: false,
    activeSlotsByTopic: persisted.activeSlotsByTopic || {},
    exposureByTopic: persisted.exposureByTopic || {},
    lastRoundByTopic: persisted.lastRoundByTopic || {},
    entries: persisted.entries || {}
  };

  const SLOT_REGEX = /\{\{([a-zA-Z0-9_]+)\|([^|{}]+)\|([^|{}]*)\|([^|{}]*)\}\}/g;
  const MIRROR_REGEX = /\{\{=([a-zA-Z0-9_]+)\|([^{}]+)\}\}/g;

  const catalogByTopic = new Map();
  const slotMetaById = new Map();
  const topicById = new Map();

  function collectSlotsFromText(txt, topicId, secIdx, slots) {
    let m;
    SLOT_REGEX.lastIndex = 0;
    while ((m = SLOT_REGEX.exec(txt)) !== null) {
      const [, id, answer, aliasRaw, group] = m;
      const aliases = aliasRaw
        ? aliasRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const meta = {
        id,
        topicId,
        secIdx,
        kind: id.startsWith("tly_") ? "year" : "event",
        answer: answer.trim(),
        aliases,
        group: group.trim() || id
      };
      slots.push(meta);
      slotMetaById.set(id, meta);
    }
  }

  for (const topic of ALL_TOPICS) {
    topicById.set(topic.id, topic);
    const slots = [];
    if (topic.timelineRows) {
      topic.timelineRows.forEach((row) => {
        const bucket = row.bucket ?? 0;
        collectSlotsFromText(row.yearText, topic.id, bucket, slots);
        row.events.forEach((ev) => {
          collectSlotsFromText(ev.text, topic.id, bucket, slots);
        });
      });
    } else if (topic.sections) {
      topic.sections.forEach((sec, secIdx) => {
        if (sec.blocks) {
          sec.blocks.forEach((b) => collectSlotsFromText(b.text, topic.id, secIdx, slots));
        }
        if (sec.reviewItems) {
          sec.reviewItems.forEach((item) => collectSlotsFromText(item.text, topic.id, secIdx, slots));
        }
      });
    }
    catalogByTopic.set(topic.id, slots);
  }

  function getTeacherForTopic(topicId) {
    if (DATASETS.song.topics.some((t) => t.id === topicId)) return "song";
    return "shin";
  }

  function getCurrentDataset() {
    return DATASETS[state.activeTeacher || "shin"];
  }

  function getActiveView() {
    const ds = getCurrentDataset();
    return state.activeViewByTeacher[ds.id] || ds.topics[0].id;
  }

  function getTimelineModeForTopic(topic) {
    const tKey = getTeacherForTopic(topic.id);
    return state.timelineModeByTeacher[tKey] || "mixed";
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          activeViewByTeacher: state.activeViewByTeacher,
          timelineModeByTeacher: state.timelineModeByTeacher,
          density: state.density,
          theme: state.theme,
          activeSlotsByTopic: state.activeSlotsByTopic,
          exposureByTopic: state.exposureByTopic,
          lastRoundByTopic: state.lastRoundByTopic,
          entries: state.entries
        })
      );
    } catch {
      // ignore storage quota errors
    }
  }

  function normalizeAnswer(str) {
    return String(str || "")
      .trim()
      .replace(/^['"‘’“”<>《》『』「」\[\]()]+|['"‘’“”<>《》『』「」\[\]()]+$/g, "")
      .replace(/[\s·ㆍ・.\-_,/]+/g, "")
      .toLowerCase();
  }

  function isAnswerMatch(userInput, meta) {
    const normUser = normalizeAnswer(userInput);
    if (!normUser) return false;
    if (normUser === normalizeAnswer(meta.answer)) return true;
    for (const alias of meta.aliases) {
      if (normUser === normalizeAnswer(alias)) return true;
    }
    return false;
  }

  function shuffle(arr) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function filterTimelineSlots(slots, topic) {
    if (!topic?.isTimeline) return slots;
    const tlMode = getTimelineModeForTopic(topic);
    if (tlMode === "years") return slots.filter((s) => s.kind === "year");
    if (tlMode === "events") return slots.filter((s) => s.kind === "event");
    return slots;
  }

  function generateBlanksForTopic(topicId, density, isReroll = false) {
    const topic = topicById.get(topicId);
    const rawSlots = catalogByTopic.get(topicId) || [];
    const allSlots = filterTimelineSlots(rawSlots, topic);
    if (!topic || allSlots.length === 0) return [];

    if (density === "read") {
      return [];
    }

    if (topic.isFixedReview || density === "all") {
      return allSlots.map((s) => s.id);
    }

    const exposure = state.exposureByTopic[topicId] || {};
    const prevSet = new Set(state.lastRoundByTopic[topicId] || state.activeSlotsByTopic[topicId] || []);

    const ratio = DENSITY_RATIOS[density] ?? 0.44;
    const chosen = new Set();
    const usedGroups = new Set();

    const bySection = new Map();
    for (const slot of allSlots) {
      if (!bySection.has(slot.secIdx)) bySection.set(slot.secIdx, []);
      bySection.get(slot.secIdx).push(slot);
    }

    for (const [, secSlots] of bySection.entries()) {
      const targetCount = Math.max(1, Math.round(secSlots.length * ratio));

      const ranked = shuffle(secSlots).sort((a, b) => {
        const aPrev = prevSet.has(a.id) ? 1 : 0;
        const bPrev = prevSet.has(b.id) ? 1 : 0;
        if (aPrev !== bPrev) return aPrev - bPrev;
        const aExp = exposure[a.id] || 0;
        const bExp = exposure[b.id] || 0;
        return aExp - bExp;
      });

      let pickedInSec = 0;

      for (const cand of ranked) {
        if (pickedInSec >= targetCount) break;
        if (usedGroups.has(cand.group)) continue;
        if (prevSet.has(cand.id) && pickedInSec >= Math.max(1, targetCount - 1)) continue;
        chosen.add(cand.id);
        usedGroups.add(cand.group);
        pickedInSec++;
      }

      if (density === "dense" && pickedInSec < targetCount) {
        for (const cand of ranked) {
          if (pickedInSec >= targetCount) break;
          if (chosen.has(cand.id)) continue;
          chosen.add(cand.id);
          pickedInSec++;
        }
      }
    }

    const orderedChosen = allSlots.filter((s) => chosen.has(s.id)).map((s) => s.id);

    if (isReroll || !state.exposureByTopic[topicId]) {
      const nextExp = { ...exposure };
      for (const id of orderedChosen) {
        nextExp[id] = (nextExp[id] || 0) + 1;
      }
      state.exposureByTopic[topicId] = nextExp;
      state.lastRoundByTopic[topicId] = orderedChosen;
    }

    return orderedChosen;
  }

  function getVisibleTopics() {
    const ds = getCurrentDataset();
    const activeView = getActiveView();
    if (activeView === ds.allViewId) {
      return ds.topics.filter((t) => !t.isFixedReview && !t.isTimeline);
    }
    const found = ds.topics.find((t) => t.id === activeView);
    return found ? [found] : [ds.topics[0]];
  }

  function ensureActiveSlots(forceReroll = false) {
    for (const topic of ALL_TOPICS) {
      const existing = state.activeSlotsByTopic[topic.id];
      if (forceReroll || !Array.isArray(existing)) {
        state.activeSlotsByTopic[topic.id] = generateBlanksForTopic(topic.id, state.density, true);
      } else if (state.density === "read") {
        // Keep stored slots intact while viewing original text
      } else if (topic.isFixedReview || state.density === "all") {
        state.activeSlotsByTopic[topic.id] = filterTimelineSlots(
          catalogByTopic.get(topic.id) || [],
          topic
        ).map((s) => s.id);
      }
    }
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function applyBoldMarkup(escapedHtml, showBold) {
    return escapedHtml.replace(/\*\*(.+?)\*\*/g, (_, inner) =>
      showBold ? `<strong class="pdf-bold">${inner}</strong>` : inner
    );
  }

  function estimateCharWidth(answer) {
    let units = 0;
    for (const ch of answer) {
      units += ch.charCodeAt(0) > 127 ? 1.85 : 1.0;
    }
    const minCh = Math.max(6, Math.ceil(units + 2.2));
    const fallbackCh = Math.max(7, Math.ceil(units + 2.8));
    return { minCh, fallbackCh };
  }

  function renderRichText(rawText, activeSet, counterRef, showBold) {
    const tokens = [];
    let cursor = 0;
    const COMBINED = /\{\{([a-zA-Z0-9_]+)\|([^|{}]+)\|([^|{}]*)\|([^|{}]*)\}\}|\{\{=([a-zA-Z0-9_]+)\|([^{}]+)\}\}/g;
    let match;

    while ((match = COMBINED.exec(rawText)) !== null) {
      if (match.index > cursor) {
        tokens.push({ kind: "text", value: rawText.slice(cursor, match.index) });
      }
      if (match[1]) {
        tokens.push({
          kind: "slot",
          id: match[1],
          answer: match[2].trim()
        });
      } else {
        tokens.push({
          kind: "mirror",
          targetId: match[5],
          surface: match[6]
        });
      }
      cursor = match.index + match[0].length;
    }
    if (cursor < rawText.length) {
      tokens.push({ kind: "text", value: rawText.slice(cursor) });
    }

    let html = "";
    for (const tok of tokens) {
      if (tok.kind === "text") {
        html += escapeHtml(tok.value);
      } else if (tok.kind === "slot") {
        if (state.density !== "read" && activeSet.has(tok.id)) {
          counterRef.num += 1;
          const num = counterRef.num;
          const entry = state.entries[tok.id] || { value: "", status: "idle" };
          const isPeek = state.peekAll && entry.status !== "correct";
          const displayVal = isPeek ? tok.answer : entry.value || "";
          const statusClass =
            entry.status === "correct"
              ? "is-correct"
              : isPeek || entry.status === "peeked"
              ? "is-peeked"
              : entry.status === "wrong"
              ? "is-wrong"
              : "";
          const { minCh, fallbackCh } = estimateCharWidth(tok.answer);
          const inputId = `blank-${tok.id}`;
          const showPeekTrigger = entry.status === "wrong" && !isPeek;

          html +=
            `<span class="blank-wrap ${statusClass}" data-slot-wrap="${tok.id}">` +
            `<label for="${inputId}" class="blank-num">${num}</label>` +
            `<input id="${inputId}" type="text" class="blank-input" data-slot-id="${tok.id}" ` +
            `value="${escapeHtml(displayVal)}" ` +
            `enterkeyhint="next" autocapitalize="none" autocorrect="off" ` +
            `style="--blank-min:${minCh}ch;--blank-fallback-w:${fallbackCh}ch" ` +
            `aria-label="빈칸 ${num}" ` +
            `${isPeek ? "readonly" : ""} />` +
            (showPeekTrigger
              ? `<button type="button" class="blank-peek-btn" data-peek-slot="${tok.id}" title="정답 확인">정답</button>`
              : "") +
            `</span>`;
        } else {
          html += escapeHtml(tok.answer);
        }
      } else if (tok.kind === "mirror") {
        if (state.density !== "read" && activeSet.has(tok.targetId)) {
          const entry = state.entries[tok.targetId] || { value: "", status: "idle" };
          const isPeek = state.peekAll && entry.status !== "correct";
          const revealed = entry.status === "correct" || entry.status === "peeked" || isPeek;
          const textInside = revealed ? tok.surface : entry.value ? entry.value : "···";
          const cls =
            entry.status === "correct"
              ? "is-correct"
              : isPeek || entry.status === "peeked"
              ? "is-peeked"
              : "";
          html += `<span class="mirror-blank ${cls}" data-mirror-for="${tok.targetId}" data-mirror-surface="${escapeHtml(tok.surface)}">${escapeHtml(textInside)}</span>`;
        } else {
          html += escapeHtml(tok.surface);
        }
      }
    }

    return applyBoldMarkup(html, showBold);
  }

  function getActiveSetForTopic(topic) {
    if (state.density === "read") return new Set();
    if (topic.isFixedReview || state.density === "all") {
      return new Set(filterTimelineSlots(catalogByTopic.get(topic.id) || [], topic).map((s) => s.id));
    }
    return new Set(state.activeSlotsByTopic[topic.id] || []);
  }

  function computeTopicProgress(topic) {
    const activeSet = getActiveSetForTopic(topic);
    const total = activeSet.size;
    let correct = 0;
    for (const id of activeSet) {
      if (state.entries[id]?.status === "correct") correct++;
    }
    return { correct, total };
  }

  function computeDatasetSummary(ds) {
    const bodyTopics = ds.topics.filter((t) => !t.isFixedReview && !t.isTimeline);
    let c = 0;
    let tot = 0;
    bodyTopics.forEach((t) => {
      const p = computeTopicProgress(t);
      c += p.correct;
      tot += p.total;
    });
    return { correct: c, total: tot };
  }

  function renderThemeState() {
    document.documentElement.setAttribute("data-theme", state.theme);
    const metaTheme = document.getElementById("meta-theme-color");
    if (metaTheme) {
      metaTheme.setAttribute("content", state.theme === "dark" ? "#1d1d1a" : "#ffffff");
    }
    const label = state.theme === "dark" ? "밝은 화면" : "어두운 화면";
    const t1 = document.getElementById("theme-toggle");
    const t2 = document.getElementById("landing-theme-toggle");
    if (t1) t1.textContent = label;
    if (t2) t2.textContent = label;
  }

  function renderLanding() {
    const shinProg = computeDatasetSummary(DATASETS.shin);
    const songProg = computeDatasetSummary(DATASETS.song);
    const shinEl = document.getElementById("landing-progress-shin");
    const songEl = document.getElementById("landing-progress-song");
    if (shinEl) {
      shinEl.textContent =
        state.density === "read" ? "원문 읽기 모드" : `현재 빈칸 ${shinProg.correct}/${shinProg.total} 완료`;
    }
    if (songEl) {
      songEl.textContent =
        state.density === "read" ? "원문 읽기 모드" : `현재 빈칸 ${songProg.correct}/${songProg.total} 완료`;
    }
  }

  function renderTabs() {
    const ds = getCurrentDataset();
    const activeView = getActiveView();
    const views = [
      ...ds.topics.map((t) => ({ id: t.id, label: t.shortLabel })),
      { id: ds.allViewId, label: ds.allViewLabel }
    ];

    const nav = document.getElementById("topic-tabs");
    nav.innerHTML = views
      .map((view) => {
        const isActive = view.id === activeView;
        let countBadge = "";
        if (state.density !== "read") {
          if (view.id === ds.allViewId) {
            const sum = computeDatasetSummary(ds);
            countBadge = `<span class="tab-count">${sum.correct}/${sum.total}</span>`;
          } else {
            const t = topicById.get(view.id);
            if (t) {
              const p = computeTopicProgress(t);
              countBadge = `<span class="tab-count">${p.correct}/${p.total}</span>`;
            }
          }
        }
        return (
          `<button type="button" class="topic-tab ${isActive ? "is-active" : ""}" data-view="${view.id}">` +
          `<span>${escapeHtml(view.label)}</span>${countBadge}` +
          `</button>`
        );
      })
      .join("");
  }

  function renderToolbarState() {
    const ds = getCurrentDataset();
    document.getElementById("workspace-title").textContent = ds.titleLabel;
    document.getElementById("workspace-subtitle").textContent = ds.rangeLabel;

    document.querySelectorAll("#header-teacher-switch .seg-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.switchTeacher === ds.id);
    });

    document.querySelectorAll("#density-control .seg-btn").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.density === state.density);
    });

    const isRead = state.density === "read";
    const visibleTopics = getVisibleTopics();
    const isReviewTab = visibleTopics.length === 1 && visibleTopics[0].isFixedReview;

    document.getElementById("btn-check-all").hidden = isRead;
    document.getElementById("btn-peek-all").hidden = isRead;
    document.getElementById("btn-clear-inputs").hidden = isRead;
    document.getElementById("btn-reroll").hidden = isRead || isReviewTab || state.density === "all";

    const peekBtn = document.getElementById("btn-peek-all");
    peekBtn.setAttribute("aria-pressed", state.peekAll ? "true" : "false");
    peekBtn.textContent = state.peekAll ? "정답 숨기기" : "정답 표시";

    const statusEl = document.getElementById("score-status");
    if (isRead) {
      statusEl.textContent = "원문 표시 중";
    } else {
      let correct = 0;
      let total = 0;
      visibleTopics.forEach((t) => {
        const p = computeTopicProgress(t);
        correct += p.correct;
        total += p.total;
      });
      statusEl.textContent = `${total}개 빈칸 중 ${correct}개 완료`;
    }
  }

  function renderSheet() {
    const container = document.getElementById("sheet-content");
    const visibleTopics = getVisibleTopics();
    const counterRef = { num: 0 };
    const showBold = state.density === "read";

    const html = visibleTopics
      .map((topic) => {
        const activeSet = getActiveSetForTopic(topic);
        let contentHtml = "";

        if (topic.isTimeline && topic.timelineRows) {
          const tlMode = getTimelineModeForTopic(topic);
          const modeFilterHtml =
            state.density !== "read"
              ? `<div class="timeline-filter-bar" role="group" aria-label="연표 빈칸 대상">` +
                `<span class="timeline-filter-label">빈칸 대상</span>` +
                `<div class="segmented">` +
                `<button type="button" class="seg-btn ${tlMode === "mixed" ? "is-active" : ""}" data-tl-mode="mixed">연도 + 사건</button>` +
                `<button type="button" class="seg-btn ${tlMode === "years" ? "is-active" : ""}" data-tl-mode="years">연도만</button>` +
                `<button type="button" class="seg-btn ${tlMode === "events" ? "is-active" : ""}" data-tl-mode="events">핵심 사건만</button>` +
                `</div>` +
                `</div>`
              : "";

          const rowsHtml = topic.timelineRows
            .map((row) => {
              const yearHtml = renderRichText(row.yearText, activeSet, counterRef, showBold);
              const eventsHtml = row.events
                .map((ev) => {
                  const evInner = renderRichText(ev.text, activeSet, counterRef, showBold);
                  const subDateHtml = ev.subDate
                    ? `<span class="tl-subdate">${escapeHtml(ev.subDate)}</span>`
                    : "";
                  const refHtml = ev.topicRef
                    ? `<span class="tl-topic-ref">${escapeHtml(ev.topicRef)}</span>`
                    : "";
                  return (
                    `<li class="tl-event-item">` +
                    `<div class="tl-event-main">${subDateHtml}<span class="tl-event-text">${evInner}</span></div>` +
                    `${refHtml}` +
                    `</li>`
                  );
                })
                .join("");

              return (
                `<div class="tl-row">` +
                `<div class="tl-year-col"><span class="tl-dot" aria-hidden="true"></span><span class="tl-year-text">${yearHtml}</span></div>` +
                `<ul class="tl-events-col">${eventsHtml}</ul>` +
                `</div>`
              );
            })
            .join("");

          contentHtml = `${modeFilterHtml}<div class="timeline-list">${rowsHtml}</div>`;
        } else {
          contentHtml = topic.sections
            .map((sec) => {
              let bodyHtml = "";
              if (sec.blocks) {
                bodyHtml = sec.blocks
                  .map((b) => {
                    const inner = renderRichText(b.text, activeSet, counterRef, showBold || b.type === "note");
                    if (b.type === "sub") {
                      return `<h4 class="subsection-heading">${inner}</h4>`;
                    }
                    if (b.type === "bullet") {
                      return `<p class="bullet-para">${inner}</p>`;
                    }
                    if (b.type === "note") {
                      return `<div class="note-para">${inner}</div>`;
                    }
                    if (b.type === "flow") {
                      return `<div class="flow-para">${inner}</div>`;
                    }
                    return `<p class="body-para ${b.indent ? "is-indented" : ""}">${inner}</p>`;
                  })
                  .join("");
              } else if (sec.reviewItems) {
                bodyHtml =
                  `<ol class="review-list">` +
                  sec.reviewItems
                    .map((item) => {
                      const inner = renderRichText(item.text, activeSet, counterRef, showBold);
                      return (
                        `<li class="review-item">` +
                        `<span class="review-num">${escapeHtml(item.num)}.</span>` +
                        `<span>${inner}</span>` +
                        `</li>`
                      );
                    })
                    .join("") +
                  `</ol>`;
              }

              return (
                `<section class="section-block">` +
                `<h3 class="section-heading">${escapeHtml(sec.heading)}</h3>` +
                `${bodyHtml}` +
                `</section>`
              );
            })
            .join("");
        }

        return (
          `<article class="topic-block" data-topic="${topic.id}">` +
          `<header class="topic-header">` +
          `<h2 class="topic-heading">${escapeHtml(topic.title)}</h2>` +
          `<span class="topic-pages">${escapeHtml(topic.pages || "")}</span>` +
          (topic.sharedHeaderNote
            ? `<p class="topic-shared-note">${escapeHtml(topic.sharedHeaderNote)}</p>`
            : "") +
          `</header>` +
          `${contentHtml}` +
          `</article>`
        );
      })
      .join("");

    container.innerHTML = html;
  }

  function renderAll() {
    renderThemeState();
    const landingEl = document.getElementById("landing-screen");
    const workspaceEl = document.getElementById("workspace-screen");

    if (!state.activeTeacher) {
      landingEl.hidden = false;
      workspaceEl.hidden = true;
      renderLanding();
      return;
    }

    landingEl.hidden = true;
    workspaceEl.hidden = false;
    renderTabs();
    renderToolbarState();
    renderSheet();
  }

  function selectTeacher(teacherId, pushHash = true) {
    if (teacherId !== "shin" && teacherId !== "song") {
      state.activeTeacher = null;
      state.peekAll = false;
      if (pushHash && window.location.hash) {
        history.pushState(null, "", window.location.pathname + window.location.search);
      }
      renderAll();
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }

    state.activeTeacher = teacherId;
    state.peekAll = false;
    if (pushHash && window.location.hash !== `#${teacherId}`) {
      history.pushState(null, "", `#${teacherId}`);
    }
    renderAll();
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  window.addEventListener("hashchange", () => {
    const nextT = parseHashTeacher();
    if (nextT !== state.activeTeacher) {
      selectTeacher(nextT, false);
    }
  });

  function updateMirrors(slotId) {
    const meta = slotMetaById.get(slotId);
    if (!meta) return;
    const entry = state.entries[slotId] || { value: "", status: "idle" };
    const isPeek = state.peekAll && entry.status !== "correct";
    const revealed = entry.status === "correct" || entry.status === "peeked" || isPeek;

    document.querySelectorAll(`[data-mirror-for="${slotId}"]`).forEach((el) => {
      const surface = el.getAttribute("data-mirror-surface") || meta.answer;
      el.textContent = revealed ? surface : entry.value ? entry.value : "···";
      el.classList.toggle("is-correct", entry.status === "correct");
      el.classList.toggle("is-peeked", isPeek || entry.status === "peeked");
    });
  }

  function syncWrapVisual(slotId) {
    const wrap = document.querySelector(`[data-slot-wrap="${slotId}"]`);
    const meta = slotMetaById.get(slotId);
    if (!wrap || !meta) return;
    const input = wrap.querySelector(".blank-input");
    const entry = state.entries[slotId] || { value: "", status: "idle" };

    wrap.classList.remove("is-correct", "is-wrong", "is-peeked");
    const existingPeekBtn = wrap.querySelector(".blank-peek-btn");
    if (existingPeekBtn) existingPeekBtn.remove();

    if (entry.status === "correct") {
      wrap.classList.add("is-correct");
      if (input && input.value !== meta.answer) {
        input.value = meta.answer;
      }
    } else if (entry.status === "peeked") {
      wrap.classList.add("is-peeked");
      if (input) input.value = meta.answer;
    } else if (entry.status === "wrong") {
      wrap.classList.add("is-wrong");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "blank-peek-btn";
      btn.dataset.peekSlot = slotId;
      btn.title = "정답 확인";
      btn.textContent = "정답";
      wrap.appendChild(btn);
    }

    updateMirrors(slotId);
    renderTabs();
    renderToolbarState();
  }

  function evaluateSlot(slotId, { markEmptyWrong = false } = {}) {
    const meta = slotMetaById.get(slotId);
    if (!meta) return "idle";
    const input = document.querySelector(`.blank-input[data-slot-id="${slotId}"]`);
    const rawVal = input ? input.value : state.entries[slotId]?.value || "";

    if (!rawVal.trim()) {
      if (markEmptyWrong) {
        state.entries[slotId] = { value: "", status: "wrong" };
        syncWrapVisual(slotId);
        saveState();
        return "wrong";
      }
      state.entries[slotId] = { value: "", status: "idle" };
      syncWrapVisual(slotId);
      saveState();
      return "idle";
    }

    if (isAnswerMatch(rawVal, meta)) {
      state.entries[slotId] = { value: meta.answer, status: "correct" };
      syncWrapVisual(slotId);
      saveState();
      return "correct";
    }

    state.entries[slotId] = { value: rawVal, status: "wrong" };
    syncWrapVisual(slotId);
    saveState();
    return "wrong";
  }

  function focusNextBlank(currentSlotId) {
    const inputs = Array.from(document.querySelectorAll(".blank-input"));
    const idx = inputs.findIndex((el) => el.dataset.slotId === currentSlotId);
    if (idx === -1) return;

    const ordered = [...inputs.slice(idx + 1), ...inputs.slice(0, idx)];
    const nextTarget = ordered.find((el) => {
      const st = state.entries[el.dataset.slotId]?.status;
      return st !== "correct";
    });
    if (nextTarget) {
      nextTarget.focus({ preventScroll: true });
      nextTarget.select();
      if (typeof nextTarget.scrollIntoView === "function") {
        nextTarget.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }
  }

  function revealSingleSlot(slotId) {
    const meta = slotMetaById.get(slotId);
    if (!meta) return;
    state.entries[slotId] = { value: meta.answer, status: "peeked" };
    syncWrapVisual(slotId);
    saveState();
  }

  let lastCompositionEndAt = null;

  document.addEventListener("compositionend", (event) => {
    if (event.target && event.target.classList?.contains("blank-input")) {
      lastCompositionEndAt = event.timeStamp;
    }
  });

  document.getElementById("study-form").addEventListener("submit", (event) => {
    event.preventDefault();
  });

  document.getElementById("teacher-cards").addEventListener("click", (event) => {
    const card = event.target.closest("[data-select-teacher]");
    if (!card) return;
    selectTeacher(card.dataset.selectTeacher);
  });

  document.getElementById("btn-back-landing").addEventListener("click", () => {
    selectTeacher(null);
  });

  document.getElementById("header-teacher-switch").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-switch-teacher]");
    if (!btn) return;
    selectTeacher(btn.dataset.switchTeacher);
  });

  document.getElementById("sheet-content").addEventListener("input", (event) => {
    const input = event.target.closest(".blank-input");
    if (!input || state.peekAll) return;
    const slotId = input.dataset.slotId;
    const prev = state.entries[slotId];
    state.entries[slotId] = {
      value: input.value,
      status:
        prev?.status === "correct" && isAnswerMatch(input.value, slotMetaById.get(slotId))
          ? "correct"
          : "idle"
    };
    syncWrapVisual(slotId);
    saveState();
  });

  document.getElementById("sheet-content").addEventListener("keydown", (event) => {
    const input = event.target.closest(".blank-input");
    if (!input) return;
    const slotId = input.dataset.slotId;

    if (event.altKey && event.code === "Slash") {
      event.preventDefault();
      revealSingleSlot(slotId);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (state.peekAll) return;

      const inRecentCompositionWindow =
        lastCompositionEndAt !== null && Math.abs(event.timeStamp - lastCompositionEndAt) < 50;

      if (event.isComposing || event.keyCode === 229 || inRecentCompositionWindow) {
        requestAnimationFrame(() => {
          const meta = slotMetaById.get(slotId);
          if (meta && isAnswerMatch(input.value, meta)) {
            evaluateSlot(slotId);
            focusNextBlank(slotId);
          }
        });
        return;
      }

      const result = evaluateSlot(slotId);
      if (result === "correct") {
        focusNextBlank(slotId);
      } else if (result === "wrong") {
        input.select();
      }
    }
  });

  document.getElementById("sheet-content").addEventListener(
    "blur",
    (event) => {
      const input = event.target.closest(".blank-input");
      if (!input || state.peekAll) return;
      const slotId = input.dataset.slotId;
      if (input.value.trim() && state.entries[slotId]?.status === "idle") {
        evaluateSlot(slotId);
      }
    },
    true
  );

  document.getElementById("sheet-content").addEventListener("click", (event) => {
    const modeBtn = event.target.closest("[data-tl-mode]");
    if (modeBtn) {
      const ds = getCurrentDataset();
      const nextMode = modeBtn.dataset.tlMode;
      if (nextMode !== state.timelineModeByTeacher[ds.id]) {
        state.timelineModeByTeacher[ds.id] = nextMode;
        state.peekAll = false;
        const tlTopic = ds.topics.find((t) => t.isTimeline);
        if (tlTopic) {
          state.activeSlotsByTopic[tlTopic.id] = generateBlanksForTopic(
            tlTopic.id,
            state.density === "read" ? "standard" : state.density,
            false
          );
        }
        saveState();
        renderAll();
      }
      return;
    }

    const peekBtn = event.target.closest("[data-peek-slot]");
    if (!peekBtn) return;
    revealSingleSlot(peekBtn.dataset.peekSlot);
  });

  document.getElementById("topic-tabs").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-view]");
    if (!btn) return;
    const ds = getCurrentDataset();
    state.activeViewByTeacher[ds.id] = btn.dataset.view;
    state.peekAll = false;
    saveState();
    renderAll();
    window.scrollTo({ top: 0, behavior: "instant" });
  });

  document.getElementById("density-control").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-density]");
    if (!btn) return;
    const nextDensity = btn.dataset.density;
    if (nextDensity === state.density) return;
    state.density = nextDensity;
    state.peekAll = false;

    if (nextDensity === "standard" || nextDensity === "dense") {
      for (const topic of getVisibleTopics()) {
        if (!topic.isFixedReview) {
          state.activeSlotsByTopic[topic.id] = generateBlanksForTopic(topic.id, nextDensity, false);
        }
      }
    } else if (nextDensity === "all") {
      for (const topic of ALL_TOPICS) {
        state.activeSlotsByTopic[topic.id] = filterTimelineSlots(
          catalogByTopic.get(topic.id) || [],
          topic
        ).map((s) => s.id);
      }
    }
    saveState();
    renderAll();
  });

  document.getElementById("btn-check-all").addEventListener("click", () => {
    if (state.peekAll) {
      state.peekAll = false;
      renderAll();
    }
    const inputs = Array.from(document.querySelectorAll(".blank-input"));
    let firstWrong = null;
    for (const input of inputs) {
      const res = evaluateSlot(input.dataset.slotId, { markEmptyWrong: true });
      if (res === "wrong" && !firstWrong) firstWrong = input;
    }
    if (firstWrong) {
      firstWrong.focus();
      firstWrong.select();
    }
  });

  document.getElementById("btn-peek-all").addEventListener("click", () => {
    state.peekAll = !state.peekAll;
    renderAll();
  });

  document.getElementById("btn-clear-inputs").addEventListener("click", () => {
    state.peekAll = false;
    for (const topic of getVisibleTopics()) {
      const activeSet = getActiveSetForTopic(topic);
      for (const id of activeSet) {
        delete state.entries[id];
      }
    }
    saveState();
    renderAll();
    const first = document.querySelector(".blank-input");
    if (first) first.focus();
  });

  function rerollVisibleTopics() {
    if (!state.activeTeacher) return;
    if (state.density === "read" || state.density === "all") {
      state.density = "standard";
    }
    state.peekAll = false;
    for (const topic of getVisibleTopics()) {
      if (topic.isFixedReview) {
        const allIds = (catalogByTopic.get(topic.id) || []).map((s) => s.id);
        allIds.forEach((id) => delete state.entries[id]);
        continue;
      }
      const topicSlots = catalogByTopic.get(topic.id) || [];
      topicSlots.forEach((s) => delete state.entries[s.id]);
      state.activeSlotsByTopic[topic.id] = generateBlanksForTopic(topic.id, state.density, true);
    }
    saveState();
    renderAll();
    const first = document.querySelector(".blank-input");
    if (first) first.focus();
  }

  document.getElementById("btn-reroll").addEventListener("click", rerollVisibleTopics);

  function toggleTheme() {
    state.theme = state.theme === "dark" ? "light" : "dark";
    saveState();
    renderThemeState();
  }

  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  document.getElementById("landing-theme-toggle").addEventListener("click", toggleTheme);

  document.addEventListener("keydown", (event) => {
    if (!state.activeTeacher && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (event.key === "1") {
        event.preventDefault();
        selectTeacher("shin");
        return;
      }
      if (event.key === "2") {
        event.preventDefault();
        selectTeacher("song");
        return;
      }
    }

    if (event.altKey && event.code === "KeyR") {
      event.preventDefault();
      rerollVisibleTopics();
    }
  });

  ensureActiveSlots(false);
  saveState();
  renderAll();
})();
