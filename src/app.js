(() => {
  "use strict";

  const courseList = window.COURSES || [];
  let activeCourse = courseList.find(item => item.id === (localStorage.getItem("azure-training-course") || "ai-103")) || courseList[0];
  const bank = activeCourse?.bank || { questions: [], cases: [] };
  const questions = bank.questions || [];
  const questionMap = new Map(questions.map(question => [question.id, question]));
  const caseMap = new Map(bank.cases.map(item => [item.id, item]));
  const content = document.getElementById("mainContent");
  const pageTitle = document.getElementById("pageTitle");
  const saveIndicator = document.getElementById("saveIndicator");
  const sidebar = document.getElementById("sidebar");
  const modal = document.getElementById("modalBackdrop");
  const modalTitle = document.getElementById("modalTitle");
  const modalContent = document.getElementById("modalContent");
  const importInput = document.getElementById("importInput");
  const authScreen = document.getElementById("authScreen");
  const appShell = document.getElementById("appShell");
  const courseSelector = document.getElementById("courseSelector");
  const courseEntryScreen = document.getElementById("courseEntryScreen");
  const courseEntryGrid = document.getElementById("courseEntryGrid");
  let currentUser = null;
  let authMode = "login";

  const defaultState = {
    version: 1,
    answers: {},
    bookmarks: [],
    notes: {},
    history: [],
    lastQuestionId: "q-1",
    settings: { language: "both", shuffle: false, theme: "light" },
  };

  let state = structuredClone(defaultState);
  let currentView = "dashboard";
  let currentQueue = questions.map(question => question.id);
  let currentIndex = 0;
  let answerCardPage = 0;
  let saveTimer = null;
  let activeDragChoice = "";

  const escapeHTML = value => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const formatText = value => escapeHTML(value).replaceAll("\n", "<br>");
  const sameAnswers = (left, right) => [...left].sort().join("") === [...right].sort().join("");
  const answeredRecord = id => state.answers[id] || {};
  const isWrong = id => (answeredRecord(id).wrongCount || 0) > 0 && !answeredRecord(id).mastered;
  const isBookmarked = id => state.bookmarks.includes(id);

  function mergeState(saved) {
    if (!saved || typeof saved !== "object") return structuredClone(defaultState);
    return {
      ...structuredClone(defaultState),
      ...saved,
      answers: saved.answers || {},
      notes: saved.notes || {},
      bookmarks: Array.isArray(saved.bookmarks) ? saved.bookmarks : [],
      history: Array.isArray(saved.history) ? saved.history.slice(-1000) : [],
      settings: { ...defaultState.settings, ...(saved.settings || {}) },
    };
  }

  function scheduleSave() {
    saveIndicator.classList.add("saving");
    saveIndicator.lastChild.textContent = "正在保存";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await QuizDB.set("progress", state);
        saveIndicator.classList.remove("saving");
        saveIndicator.lastChild.textContent = "进度已保存";
      } catch {
        saveIndicator.classList.remove("saving");
        saveIndicator.lastChild.textContent = "保存失败";
      }
    }, 250);
  }

  function toast(message) {
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 2200);
  }

  function setTitle(title) {
    pageTitle.textContent = title;
    document.title = `${title} · Azure Training Platform`;
  }

  function renderCourseSelector() {
    if (!courseSelector) return;
    courseSelector.innerHTML = courseList.map(course => `<option value="${course.id}" ${course.id === activeCourse.id ? "selected" : ""}>${course.code} · ${course.title}${course.status === "available" ? "" : "（即将上线）"}</option>`).join("");
  }

  function switchCourse(id) {
    const course = courseList.find(item => item.id === id);
    if (!course || course.status !== "available") { toast("该课程题库正在准备中"); renderCourseSelector(); return; }
    localStorage.setItem("azure-training-course", id);
    window.location.reload();
  }

  function showCourseEntry() {
    authScreen.hidden = true; appShell.hidden = true; courseEntryScreen.hidden = false;
    courseEntryGrid.innerHTML = courseList.map(course => `<button class="course-entry-card" data-entry-course="${course.id}" ${course.status === "available" ? "" : "disabled"}><strong>${course.code}</strong><span>${course.title} · ${course.status === "available" ? "进入学习" : "题库即将上线"}</span></button>`).join("");
  }

  function enterSelectedCourse(id) {
    const course = courseList.find(item => item.id === id);
    if (!course || course.status !== "available") return;
    localStorage.setItem("azure-training-course", id);
    window.location.reload();
  }

  function setActiveNav(view) {
    document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.view === view));
    sidebar.classList.remove("open");
  }

  function metrics() {
    const records = Object.values(state.answers);
    const completed = records.filter(item => item.submitted).length;
    const correct = records.filter(item => item.submitted && item.correct).length;
    const wrong = questions.filter(question => isWrong(question.id)).length;
    const mastered = records.filter(item => item.mastered).length;
    return { completed, correct, wrong, mastered, accuracy: completed ? Math.round(correct / completed * 100) : 0 };
  }

  function renderDashboard() {
    currentView = "dashboard";
    setTitle("学习概览");
    setActiveNav("dashboard");
    const m = metrics();
    const progress = questions.length ? Math.round(m.completed / questions.length * 100) : 0;
    const recent = state.history.slice(-5).reverse();
    if (!questions.length) { content.innerHTML = `<div class="empty-state"><div><strong>${escapeHTML(activeCourse.code)} 题库即将上线</strong><span>课程入口已预留，准备完成后即可开始练习。</span></div></div>`; return; }
    content.innerHTML = `
      <div class="content-header">
        <div><h1>今天从哪里开始？</h1><p>所有答题记录都会自动保存到你的账号。</p></div>
        <button class="button primary" data-action="start-all">继续第 ${escapeHTML((questionMap.get(state.lastQuestionId) || questions[0]).number)} 题</button>
      </div>
      <section class="metric-grid">
        ${metricCard("完成进度", `${m.completed} / ${questions.length}`, `${progress}% 已完成`, progress)}
        ${metricCard("当前正确率", `${m.accuracy}%`, `答对 ${m.correct} 题`, m.accuracy)}
        ${metricCard("待复习错题", m.wrong, "连续答对两次后掌握", Math.min(100, m.wrong / questions.length * 100), "red")}
        ${metricCard("已掌握", m.mastered, `收藏 ${state.bookmarks.length} 题`, Math.min(100, m.mastered / questions.length * 100), "green")}
      </section>
      <section class="dashboard-grid">
        <div class="panel">
          <h2>选择练习方式</h2>
          <div class="practice-options">
            ${practiceOption("all", "顺序练习", `从上次位置继续，覆盖全部 ${questions.length} 题`)}
            ${practiceOption("unanswered", "未做题", `${questions.length - m.completed} 道尚未提交的题目`)}
            ${practiceOption("wrong", "错题强化", `${m.wrong} 道当前待复习错题`)}
            ${practiceOption("random20", "随机 20 题", "打乱顺序，适合快速练习")}
            ${practiceOption("bookmarks", "收藏题练习", `${state.bookmarks.length} 道已收藏题目`)}
            ${practiceOption("visual", "图示题专项", "热点、拖拽与代码填空题")}
          </div>
        </div>
        <div class="panel">
          <h2>最近练习</h2>
          <div class="activity-list">
            ${recent.length ? recent.map(item => {
              const q = questionMap.get(item.id);
              return `<div class="activity-row"><span class="dot" style="background:${item.correct ? "var(--green)" : "var(--red)"}"></span><span>第 ${q?.number || "-"} 题 · ${item.correct ? "答对" : "需复习"}</span><time>${relativeTime(item.at)}</time></div>`;
            }).join("") : `<div class="empty-state" style="min-height:170px"><div><strong>还没有练习记录</strong>选择一种练习方式开始。</div></div>`}
          </div>
        </div>
      </section>`;
  }

  function metricCard(label, value, detail, percent, tone = "primary") {
    const color = tone === "red" ? "var(--red)" : tone === "green" ? "var(--green)" : "var(--primary)";
    return `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="detail">${detail}</div><div class="progress-bar"><span style="width:${Math.max(0, Math.min(100, percent))}%;background:${color}"></span></div></div>`;
  }

  function practiceOption(mode, title, detail) {
    return `<button class="practice-option" data-start-mode="${mode}"><strong>${title}</strong><span>${detail}</span></button>`;
  }

  function relativeTime(timestamp) {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return new Date(timestamp).toLocaleDateString("zh-CN");
  }

  function queueFor(mode) {
    let list = questions;
    if (mode === "unanswered") list = questions.filter(q => !answeredRecord(q.id).submitted);
    if (mode === "wrong") list = questions.filter(q => isWrong(q.id));
    if (mode === "bookmarks") list = questions.filter(q => isBookmarked(q.id));
    if (mode === "visual") list = questions.filter(q => q.type === "visual" || q.type === "grouped");
    if (mode === "random20") list = [...questions].sort(() => Math.random() - .5).slice(0, 20);
    return list.map(q => q.id);
  }

  function startPractice(mode = "all", requestedId = null) {
    const queue = queueFor(mode);
    if (!queue.length) {
      toast("当前没有符合条件的题目");
      return;
    }
    currentQueue = queue;
    const target = requestedId || (mode === "all" ? state.lastQuestionId : queue[0]);
    currentIndex = Math.max(0, currentQueue.indexOf(target));
    currentView = "practice";
    renderPractice();
  }

  function renderPractice(syncAnswerCard = true) {
    activeDragChoice = "";
    const question = questionMap.get(currentQueue[currentIndex]);
    if (!question) return renderDashboard();
    state.lastQuestionId = question.id;
    scheduleSave();
    setTitle(`第 ${question.number} 题`);
    setActiveNav("");
    const record = answeredRecord(question.id);
    const selected = record.selected || [];
    const lang = state.settings.language;
    const progress = (currentIndex + 1) / currentQueue.length * 100;
    const answerCardPageSize = 100;
    const answerCardPages = Math.max(1, Math.ceil(currentQueue.length / answerCardPageSize));
    if (syncAnswerCard) answerCardPage = Math.floor(currentIndex / answerCardPageSize);
    answerCardPage = Math.min(Math.max(0, answerCardPage), answerCardPages - 1);
    const answerCardStart = answerCardPage * answerCardPageSize;
    const answerCardItems = currentQueue.slice(answerCardStart, answerCardStart + answerCardPageSize);
    const visualImage = question.sourceImages[Math.max(0, question.sourceImages.length - 2)];
    content.innerHTML = `
      <div class="quiz-layout">
        <div class="quiz-main">
          <div class="quiz-header">
            <button class="icon-button" data-action="prev" title="上一题" aria-label="上一题" ${currentIndex === 0 ? "disabled" : ""}>←</button>
            <div class="quiz-progress"><div class="line"><span style="width:${progress}%"></span></div><small>${currentIndex + 1} / ${currentQueue.length} · 题库编号 ${question.number}</small></div>
            <button class="icon-button" data-action="next" title="下一题" aria-label="下一题" ${currentIndex === currentQueue.length - 1 ? "disabled" : ""}>→</button>
          </div>
          <article class="question-card">
            <div class="question-meta">
              <strong>Question #${question.number}</strong>
              <span class="tag">${questionTypeLabel(question.type)}</span>
              ${question.caseId ? `<span class="tag case">案例题</span><button class="button small" data-show-case="${question.caseId}">查看案例</button>` : ""}
            </div>
            <div class="question-body">
              ${lang !== "zh" ? `<div class="question-copy">${formatText(question.questionEn)}</div>` : ""}
              ${lang !== "en" ? `<div class="question-copy zh">${formatText(question.questionZh)}</div>` : ""}
              ${question.type === "visual" ? `${renderVisualSource(question, visualImage)}${renderVisualQuestion(question, record, visualImage)}` : question.type === "grouped" ? renderGroupedOptions(question, selected, record) : renderOptions(question, selected, record)}
              <div class="note-box"><label for="questionNote">个人笔记</label><textarea id="questionNote" data-note-id="${question.id}" placeholder="记录易错点、关键词或复习提示">${escapeHTML(state.notes[question.id] || "")}</textarea></div>
            </div>
            ${renderQuestionActions(question, record, selected)}
            ${record.submitted ? renderAnswerPanel(question, record) : ""}
          </article>
        </div>
        <aside class="quiz-side panel">
          <h2>答题卡</h2>
          <div class="answer-card-range">${answerCardStart + 1}-${Math.min(answerCardStart + answerCardPageSize, currentQueue.length)} / ${currentQueue.length}</div>
          <div class="answer-grid">${answerCardItems.map((id, index) => answerCell(id, answerCardStart + index)).join("")}</div>
          ${answerCardPages > 1 ? `<div class="answer-card-pagination"><button class="button small" data-answer-card-page="${answerCardPage - 1}" ${answerCardPage === 0 ? "disabled" : ""}>上一页</button><span>${answerCardPage + 1} / ${answerCardPages}</span><button class="button small" data-answer-card-page="${answerCardPage + 1}" ${answerCardPage === answerCardPages - 1 ? "disabled" : ""}>下一页</button></div>` : ""}
          <div class="legend"><span class="l-answered">已答</span><span class="l-correct">正确</span><span class="l-wrong">错题</span></div>
          <div class="jump-control"><input id="jumpInput" type="number" min="1" max="${questions.length}" placeholder="输入题号"><button class="button small" data-action="jump">跳转</button></div>
        </aside>
      </div>`;
  }

  function renderVisualQuestion(question, record, visualImage) {
    if (question.visualInputs?.length) {
      if (isDragDropQuestion(question)) return renderDragDropQuestion(question, record, visualImage);
      const selected = record.selected || [];
      return `<div class="answer-area-title"><strong>答题区</strong><span>请填写每一项答案后提交</span></div><div class="visual-inputs">${question.visualInputs.map(item => {
        const value = selected.find(token => token.startsWith(`${item.id}:`))?.slice(item.id.length + 1) || "";
        const correct = record.submitted && normalizeVisualValue(value) === normalizeVisualValue(item.answer);
        const control = item.choices?.length
          ? `<select data-visual-input="${item.id}" ${record.submitted ? "disabled" : ""}><option value="">请选择</option>${item.choices.map(choice => `<option value="${escapeHTML(choice)}" ${choice === value ? "selected" : ""}>${escapeHTML(choice)}</option>`).join("")}</select>`
          : `<input data-visual-input="${item.id}" value="${escapeHTML(value)}" ${record.submitted ? "disabled" : ""} placeholder="输入答案">`;
        return `<label class="visual-input-row ${record.submitted ? (correct ? "correct" : "incorrect") : ""}"><span>${escapeHTML(item.label)}</span>${control}${record.submitted ? `<small>官方答案：${escapeHTML(item.answer)}</small>` : ""}</label>`;
      }).join("")}</div>`;
    }
    if (question.visualGroups?.length) {
      return `${renderGroupedOptions(question, record.selected || [], record)}`;
    }
    const result = record.submitted
      ? `<div class="visual-self-result ${record.correct ? "correct" : "wrong"}">${record.correct ? "已标记掌握" : "已加入复习"}</div>`
      : `<div class="visual-self-actions"><button class="button danger" data-self="wrong">加入复习</button><button class="button primary" data-self="correct">标记掌握</button></div>`;
    return `<div class="answer-area-title"><strong>答题区</strong><span>查看题干和原题图后，根据掌握情况进行自评</span></div><div class="visual-official-answer"><strong>官方答案核对</strong><span>${escapeHTML(officialAnswerSummary(question))}</span></div>${result}`;
  }

  function renderVisualSource(question, visualImage) {
    const images = (question.exhibitImages?.length ? question.exhibitImages : question.sourceImages || []).slice(0, 2);
    if (!images.length && visualImage) images.push(visualImage);
    if (!images.length) return "";
    return `<details class="visual-source"><summary>原题图示（点击展开）</summary>${images.map((src, index) => `<div class="visual-prompt"><img src="${escapeHTML(src)}" alt="第 ${question.number} 题原始题面 ${index + 1}"></div>`).join("")}</details>`;
  }

  function isDragDropQuestion(question) {
    return question.interaction === "drag-drop" || /^\s*DRAG DROP\b/i.test(question.questionEn || "");
  }

  function visualInputValue(record, item) {
    return (record.selected || []).find(token => token.startsWith(`${item.id}:`))?.slice(item.id.length + 1) || "";
  }

  function renderDragDropQuestion(question, record, visualImage) {
    const choices = [...new Set(question.visualInputs.flatMap(item => item.choices || []))];
    const poolTitles = { 5: "Configurations", 15: "Observability signals", 30: "Values", 32: "Tools", 77: "Values", 86: "Values", 94: "Options", 95: "Actions", 108: "Actions", 112: "Actions" };
    const usedChoices = new Set(question.visualInputs.map(item => visualInputValue(record, item)).filter(Boolean));
    const pool = choices.map(choice => {
      const used = usedChoices.has(choice);
      const disabled = record.submitted || used;
      return `<button type="button" class="drag-choice ${used ? "used" : ""}" draggable="${disabled ? "false" : "true"}" data-drag-choice="${escapeHTML(choice)}" ${disabled ? "disabled" : ""} aria-disabled="${disabled}"><span class="drag-handle" aria-hidden="true">⠿</span><span>${escapeHTML(choice)}</span>${used ? `<span class="drag-used-label">已使用</span>` : ""}</button>`;
    }).join("");
    const slots = question.visualInputs.map(item => {
      const value = visualInputValue(record, item);
      const correct = record.submitted && normalizeVisualValue(value) === normalizeVisualValue(item.answer);
      return `<div class="drag-answer-row ${record.submitted ? (correct ? "correct" : "incorrect") : ""}"><div class="drag-prompt">${escapeHTML(item.label)}</div>${renderDropZone(item, record)}${record.submitted ? `<small>官方答案：${escapeHTML(item.answer)}</small>` : ""}</div>`;
    }).join("");
    const answerArea = renderDragCodeTemplate(question, record) || slots;
    return `<div class="answer-area-title"><strong>答题区</strong><span>将左侧候选项拖到右侧对应的答案槽</span></div><div class="drag-drop-board"><section class="drag-pool" aria-label="候选答案"><h3>${poolTitles[question.number] || "Options"}</h3><div class="drag-choice-list">${pool}</div></section><section class="drag-answer-area" aria-label="答案区域"><h3>Answer Area</h3>${answerArea}</section></div>`;
  }

  function renderDropZone(item, record) {
    const value = visualInputValue(record, item);
    const correct = record.submitted && normalizeVisualValue(value) === normalizeVisualValue(item.answer);
    const stateClass = record.submitted ? (correct ? "correct" : "incorrect") : "";
    return `<div class="drop-zone ${value ? "filled" : ""} ${stateClass}" data-drop-input="${item.id}" tabindex="${record.submitted ? "-1" : "0"}" role="button" aria-label="${escapeHTML(item.label)} 的答案槽">${value ? `<span>${escapeHTML(value)}</span>${record.submitted ? "" : `<button type="button" class="drop-clear" data-clear-input="${item.id}" title="清除此项" aria-label="清除此项">×</button>`}` : `<span class="drop-placeholder">拖放答案</span>`}</div>`;
  }

  function renderDragCodeTemplate(question, record) {
    const [first, second] = question.visualInputs;
    if (question.number === 30) {
      return `<div class="code-answer-template"><div>run_payload = {</div><div class="code-indent">"assistant_id": agent_id,</div><div class="code-inline code-indent">${renderDropZone(first, record)}<span>:</span>${renderDropZone(second, record)}<span>,</span></div><div class="code-indent">"metadata": {</div><div class="code-indent-2">"scenario": "ticket-triage"</div><div class="code-indent">}</div><div>}</div></div>`;
    }
    if (question.number === 77) {
      return `<div class="code-answer-template"><div>from azure.ai.projects.models import MemorySearchTool,</div><div>PromptAgentDefinition</div><div>mem_store_name = "agent_mem_store"</div><div>memory_tool = MemorySearchTool(</div><div class="code-indent">memory_store_name=mem_store_name,</div><div class="code-inline code-indent"><span>scope=</span>${renderDropZone(first, record)}<span>,</span></div><div>)</div><div>agent_def = PromptAgentDefinition(</div><div class="code-indent">model="gpt-5.2",</div><div class="code-indent">instructions="You are a customer support assistant.",</div><div class="code-inline code-indent"><span>tools=</span>${renderDropZone(second, record)}</div><div>)</div></div>`;
    }
    return "";
  }

  function setVisualInputValue(inputId, value) {
    const question = questionMap.get(currentQueue[currentIndex]);
    const record = answeredRecord(question.id);
    if (record.submitted) return;
    const prefix = `${inputId}:`;
    const selected = (record.selected || []).filter(token => !token.startsWith(prefix));
    if (value) selected.push(`${prefix}${value}`);
    state.answers[question.id] = { ...record, selected };
    scheduleSave();
    renderPractice();
  }

  function normalizeVisualValue(value) {
    return String(value || "").trim().toLowerCase().replaceAll(/[\s"'()._-]+/g, "");
  }

  function officialAnswerSummary(question) {
    const lines = String(question.analysis || "").split("\n");
    const marker = lines.findIndex(line => /官方答案/.test(line));
    if (marker >= 0) {
      const answerLines = lines.slice(marker + 1, marker + 5).filter(line => line.trim() && !/比较|验证|原因|官方答案/.test(line));
      if (answerLines.length) return answerLines.join("；");
    }
    const recommendation = lines.find(line => /推荐答案|正确答案/.test(line) && line.trim().length < 180);
    return recommendation ? recommendation.replace(/^.*?(推荐答案|正确答案)\s*[:：]?\s*/, "") : "请查看原题图中的 Correct Answer 圈选";
  }

  function renderOptions(question, selected, record) {
    let options = [...question.options];
    if (state.settings.shuffle) options.sort((a, b) => stableHash(`${question.id}-${a.id}`) - stableHash(`${question.id}-${b.id}`));
    return `<div class="answer-area-title"><strong>答题区</strong><span>${question.type === "multiple" ? "请选择所有符合要求的选项" : "请选择一个答案"}</span></div><div class="options">${options.map(option => {
      const chosen = selected.includes(option.id);
      const isAnswer = question.answer.includes(option.id);
      const classes = ["option", chosen ? "selected" : ""];
      if (record.submitted && isAnswer) classes.push("correct");
      if (record.submitted && chosen && !isAnswer) classes.push("incorrect");
      return `<button class="${classes.join(" ")}" data-option="${option.id}" ${record.submitted ? "disabled" : ""}><span class="option-key">${option.id}</span><span class="option-copy">${formatText(option.en)}${option.zh ? `<span class="zh">${formatText(option.zh)}</span>` : ""}</span></button>`;
    }).join("")}</div>`;
  }

  function renderGroupedOptions(question, selected, record) {
    return `<div class="answer-area-title"><strong>答题区</strong><span>每一组都需要选择一个答案</span></div><div class="grouped-options">${question.visualGroups.map(group => `<section class="option-group"><h3>${escapeHTML(group.labelZh)} <span>${escapeHTML(group.labelEn)}</span></h3><div class="options">${group.options.map((label, index) => {
      const token = `${group.id}:${label}`;
      const chosen = selected.includes(token);
      const isAnswer = question.answer.includes(token);
      const classes = ["option", chosen ? "selected" : ""];
      if (record.submitted && isAnswer) classes.push("correct");
      if (record.submitted && chosen && !isAnswer) classes.push("incorrect");
      return `<button class="${classes.join(" ")}" data-option="${escapeHTML(token)}" ${record.submitted ? "disabled" : ""}><span class="option-key">${index + 1}</span><span class="option-copy">${escapeHTML(label)}</span></button>`;
    }).join("")}</div></section>`).join("")}</div>`;
  }

  function renderQuestionActions(question, record, selected) {
    const bookmarked = isBookmarked(question.id);
    if (question.type === "visual" && !question.visualInputs?.length && !question.visualGroups?.length) {
      return `<div class="question-actions"><button class="button" data-action="bookmark">${bookmarked ? "★ 已收藏" : "☆ 收藏"}</button><button class="button" data-action="show-source">查看完整原题页</button><span class="spacer"></span>${record.submitted ? `<button class="button" data-action="retry">重新自评</button>` : ""}</div>`;
    }
    return `<div class="question-actions">
      <button class="button" data-action="bookmark">${bookmarked ? "★ 已收藏" : "☆ 收藏"}</button>
      <button class="button" data-action="show-source">原题页</button>
      <span class="spacer"></span>
      ${!record.submitted ? `<button class="button primary" data-action="submit" ${canSubmit(question, selected) ? "" : "disabled"}>提交答案</button>` : `<button class="button" data-action="retry">重新作答</button>`}
    </div>`;
  }

  function canSubmit(question, selected) {
    if (question.visualInputs?.length) return question.visualInputs.every(item => selected.some(token => token.startsWith(`${item.id}:`) && token.length > item.id.length + 1));
    if (question.visualGroups?.length) return selected.length === question.visualGroups.length;
    if (question.type === "grouped") return selected.length === question.visualGroups.length;
    return selected.length > 0;
  }

  function questionTypeLabel(type) {
    return type === "single" ? "单选" : type === "multiple" ? "多选" : type === "grouped" ? "组合选择" : "图示题";
  }

  function renderAnswerPanel(question, record) {
    const text = question.type === "visual" && !question.visualInputs?.length && !question.visualGroups?.length
      ? (record.correct ? "已标记为掌握" : "已加入针对性复习")
      : (record.correct ? "回答正确" : `回答错误 · 正确答案：${formatAnswer(question)}`);
    return `<section class="answer-panel"><div class="answer-result ${record.correct ? "correct" : "wrong"}">${text}</div>${question.analysis ? `<h3>题目分析与解答</h3><div class="analysis">${formatText(question.analysis)}</div>` : `<div class="analysis">该题为图示交互题，请结合原题页和解析页进行自评。</div>`}</section>`;
  }

  function formatAnswer(question) {
    if (question.visualInputs?.length) return question.visualInputs.map(item => `${item.label}: ${item.answer}`).join("；");
    if (question.type !== "grouped" && !question.visualGroups?.length) return question.answer.join("、");
    return question.answer.map(token => token.split(":").slice(1).join(":")).join("；");
  }

  function answerCell(id, index) {
    const record = answeredRecord(id);
    const classes = ["answer-cell"];
    if (index === currentIndex) classes.push("current");
    if (record.submitted) classes.push(record.correct ? "correct" : "wrong");
    else if ((record.selected || []).length) classes.push("answered");
    if (isBookmarked(id)) classes.push("bookmarked");
    return `<button class="${classes.join(" ")}" data-queue-index="${index}">${questionMap.get(id).number}</button>`;
  }

  function chooseOption(optionId) {
    const question = questionMap.get(currentQueue[currentIndex]);
    const record = answeredRecord(question.id);
    if (record.submitted || (question.type === "visual" && !question.visualGroups?.length)) return;
    const selected = new Set(record.selected || []);
    if (question.type === "single") selected.clear();
    if (question.type === "grouped") {
      const groupId = optionId.split(":", 1)[0];
      [...selected].filter(item => item.startsWith(`${groupId}:`)).forEach(item => selected.delete(item));
    }
    if (selected.has(optionId)) selected.delete(optionId); else selected.add(optionId);
    state.answers[question.id] = { ...record, selected: [...selected] };
    scheduleSave();
    renderPractice();
  }

  function submitCurrent(forceCorrect = null) {
    const question = questionMap.get(currentQueue[currentIndex]);
    const previous = answeredRecord(question.id);
    const selected = previous.selected || [];
    if (forceCorrect === null && !canSubmit(question, selected)) return;
    const correct = forceCorrect ?? (question.visualInputs?.length
      ? question.visualInputs.every(item => {
        const value = selected.find(token => token.startsWith(`${item.id}:`))?.slice(item.id.length + 1) || "";
        return normalizeVisualValue(value) === normalizeVisualValue(item.answer);
      })
      : sameAnswers(selected, question.answer));
    const wrongCount = (previous.wrongCount || 0) + (correct ? 0 : 1);
    const correctStreak = correct ? (previous.correctStreak || 0) + 1 : 0;
    state.answers[question.id] = {
      ...previous, selected, submitted: true, correct, wrongCount, correctStreak,
      mastered: correctStreak >= 2, lastAnsweredAt: Date.now(), attempts: (previous.attempts || 0) + 1,
    };
    state.history.push({ id: question.id, correct, at: Date.now() });
    state.history = state.history.slice(-1000);
    scheduleSave();
    renderPractice();
  }

  function retryCurrent() {
    const question = questionMap.get(currentQueue[currentIndex]);
    const record = answeredRecord(question.id);
    state.answers[question.id] = { ...record, selected: [], submitted: false, correct: false };
    scheduleSave();
    renderPractice();
  }

  function toggleBookmark() {
    const id = currentQueue[currentIndex];
    state.bookmarks = isBookmarked(id) ? state.bookmarks.filter(item => item !== id) : [...state.bookmarks, id];
    scheduleSave();
    renderPractice();
  }

  function moveQuestion(offset) {
    const next = currentIndex + offset;
    if (next < 0 || next >= currentQueue.length) return;
    currentIndex = next;
    renderPractice();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderQuestionBrowser(filter = {}) {
    currentView = filter.view || "questions";
    const title = currentView === "wrong" ? "错题本" : currentView === "bookmarks" ? "收藏题" : "题库浏览";
    setTitle(title);
    setActiveNav(currentView);
    let list = questions;
    if (currentView === "wrong") list = list.filter(q => isWrong(q.id));
    if (currentView === "bookmarks") list = list.filter(q => isBookmarked(q.id));
    if (filter.type) list = list.filter(q => q.type === filter.type);
    if (filter.status === "unanswered") list = list.filter(q => !answeredRecord(q.id).submitted);
    if (filter.query) {
      const query = filter.query.toLowerCase();
      list = list.filter(q => String(q.number) === query || `${q.questionEn} ${q.questionZh}`.toLowerCase().includes(query));
    }
    content.innerHTML = `
      <div class="content-header"><div><h1>${title}</h1><p>共 ${list.length} 题，点击任意题目进入练习。</p></div>${list.length ? `<button class="button primary" data-start-list="${currentView}">练习当前列表</button>` : ""}</div>
      <div class="toolbar"><input id="listSearch" type="search" placeholder="搜索题干或题号" value="${escapeHTML(filter.query || "")}"><select id="typeFilter"><option value="">全部题型</option><option value="single" ${filter.type === "single" ? "selected" : ""}>单选题</option><option value="multiple" ${filter.type === "multiple" ? "selected" : ""}>多选题</option><option value="grouped" ${filter.type === "grouped" ? "selected" : ""}>组合选择题</option><option value="visual" ${filter.type === "visual" ? "selected" : ""}>图示题</option></select><select id="statusFilter"><option value="">全部状态</option><option value="unanswered" ${filter.status === "unanswered" ? "selected" : ""}>未作答</option></select></div>
      ${list.length ? `<div class="question-list">${list.map(questionRow).join("")}</div>` : emptyState(currentView === "wrong" ? "错题本还是空的" : currentView === "bookmarks" ? "还没有收藏题目" : "没有匹配的题目", "完成练习或调整筛选条件后再查看。")}`;
    content.dataset.listIds = list.map(q => q.id).join(",");
  }

  function questionRow(question) {
    const record = answeredRecord(question.id);
    return `<div class="question-row"><div class="question-number">${question.number}</div><div class="question-summary"><strong>${escapeHTML((question.questionZh || question.questionEn).replaceAll("\n", " "))}</strong><span>${question.topic} · ${questionTypeLabel(question.type)}</span><div class="status-tags">${record.submitted ? `<span class="tag ${record.correct ? "correct" : "wrong"}">${record.correct ? "已答对" : "需复习"}</span>` : `<span class="tag">未作答</span>`}${question.caseId ? `<span class="tag case">案例题</span>` : ""}${isBookmarked(question.id) ? `<span class="tag case">已收藏</span>` : ""}</div></div><button class="button small" data-open-question="${question.id}">打开</button></div>`;
  }

  function renderCases() {
    currentView = "cases";
    setTitle("案例资料");
    setActiveNav("cases");
    content.innerHTML = `<div class="content-header"><div><h1>案例资料</h1><p>场景说明集中展示，答题时可随时从侧栏打开。</p></div></div>${bank.cases.map(item => `<section class="panel case-card"><div><h2>${escapeHTML(item.titleZh)}</h2><p>${escapeHTML(item.title)}</p><div class="status-tags"><span class="tag case">关联 ${item.questionIds.length} 题</span></div></div><div><button class="button" data-show-case="${item.id}">阅读案例</button><button class="button primary" data-start-case="${item.id}">练习案例题</button></div></section>`).join("")}`;
  }

  function showCase(id) {
    const item = caseMap.get(id);
    if (!item) return;
    modalTitle.textContent = item.titleZh;
    modalContent.innerHTML = `<div class="case-description"><strong>English</strong><br>${formatText(item.descriptionEn)}<br><br><strong>中文</strong><br>${formatText(item.descriptionZh)}</div><div class="question-actions" style="padding-left:0;padding-right:0"><button class="button" data-show-case-images="${id}">查看原始案例页</button><button class="button primary" data-start-case="${id}">练习 ${item.questionIds.length} 道案例题</button></div>`;
    modal.hidden = false;
  }

  function showCaseImages(id) {
    const item = caseMap.get(id);
    modalContent.innerHTML = item.sourceImages.map((src, index) => `<img class="source-image" src="${src}" alt="案例原始页 ${index + 1}">`).join("");
  }

  function showSource(question) {
    modalTitle.textContent = `第 ${question.number} 题 · 原题页`;
    modalContent.innerHTML = question.sourceImages.map((src, index) => `<img class="source-image" src="${src}" alt="第 ${question.number} 题原始页 ${index + 1}">`).join("");
    modal.hidden = false;
  }

  function renderStats() {
    currentView = "stats";
    setTitle("学习统计");
    setActiveNav("stats");
    const m = metrics();
    const types = [
      ["单选题", questions.filter(q => q.type === "single")],
      ["多选题", questions.filter(q => q.type === "multiple")],
      ["组合选择题", questions.filter(q => q.type === "grouped")],
      ["图示题", questions.filter(q => q.type === "visual")],
      ["案例题", questions.filter(q => q.caseId)],
    ];
    content.innerHTML = `<div class="content-header"><div><h1>学习统计</h1><p>根据本浏览器中保存的答题记录计算。</p></div></div><section class="metric-grid">${metricCard("累计作答", m.completed, `${questions.length - m.completed} 题未完成`, m.completed / questions.length * 100)}${metricCard("正确率", `${m.accuracy}%`, `答对 ${m.correct} 题`, m.accuracy)}${metricCard("待复习", m.wrong, "当前错题本", m.wrong / questions.length * 100, "red")}${metricCard("已掌握", m.mastered, "连续答对至少两次", m.mastered / questions.length * 100, "green")}</section><section class="panel" style="margin-top:18px"><h2>按题型统计</h2>${types.map(([label, list]) => { const done = list.filter(q => answeredRecord(q.id).submitted).length; const right = list.filter(q => answeredRecord(q.id).correct).length; const acc = done ? Math.round(right / done * 100) : 0; return `<div class="setting-row"><div><strong>${label}</strong><span>${done} / ${list.length} 已作答</span></div><div style="min-width:160px;text-align:right"><strong>${acc}%</strong><div class="progress-bar"><span style="width:${acc}%"></span></div></div></div>`; }).join("")}</section>`;
  }

  function renderSettings() {
    currentView = "settings";
    setTitle("设置与备份");
    setActiveNav("settings");
    content.innerHTML = `<div class="content-header"><div><h1>设置与备份</h1><p>学习记录保存在当前浏览器；建议定期导出备份。</p></div></div><div class="settings-grid"><section class="panel"><h2>练习设置</h2><div class="setting-row"><div><strong>题干语言</strong><span>控制刷题页的题干显示</span></div><select id="languageSetting"><option value="both" ${state.settings.language === "both" ? "selected" : ""}>中英对照</option><option value="zh" ${state.settings.language === "zh" ? "selected" : ""}>仅中文</option><option value="en" ${state.settings.language === "en" ? "selected" : ""}>仅英文</option></select></div><div class="setting-row"><div><strong>选项顺序</strong><span>打乱后仍按原答案字母判定</span></div><label><input type="checkbox" id="shuffleSetting" ${state.settings.shuffle ? "checked" : ""}> 打乱选项</label></div></section><section class="panel"><h2>数据管理</h2><div class="setting-row"><div><strong>导出学习记录</strong><span>下载 JSON 文件，可用于迁移或恢复</span></div><button class="button" data-action="export">导出</button></div><div class="setting-row"><div><strong>导入学习记录</strong><span>从之前导出的 JSON 文件恢复</span></div><button class="button" data-action="import">导入</button></div><div class="setting-row"><div><strong>清空全部进度</strong><span>删除答题、错题、收藏和笔记</span></div><button class="button danger" data-action="reset">清空</button></div></section></div>`;
  }

  function emptyState(title, detail) {
    return `<div class="empty-state"><div><strong>${title}</strong>${detail}</div></div>`;
  }

  function stableHash(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function navigate(view) {
    if (view === "dashboard") renderDashboard();
    else if (["questions", "wrong", "bookmarks"].includes(view)) renderQuestionBrowser({ view });
    else if (view === "cases") renderCases();
    else if (view === "stats") renderStats();
    else if (view === "settings") renderSettings();
    else if (view === "admin" && currentUser?.isAdmin) renderAdmin();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function renderAdmin() {
    currentView = "admin"; setTitle("用户管理"); setActiveNav("admin");
    content.innerHTML = `<div class="content-header"><div><h1>用户管理</h1><p>管理员可以修改用户密码或删除普通用户。</p></div></div><section class="panel"><div id="adminUsers">正在加载...</div></section>`;
    try {
      const data = await QuizAuth.users();
      document.getElementById("adminUsers").innerHTML = data.users.map(user => `<div class="setting-row"><div><strong>${escapeHTML(user.username)}${user.isAdmin ? "（管理员）" : ""}</strong><span>注册于 ${escapeHTML(user.createdAt)}</span></div><div class="admin-user-actions"><button class="button small" data-reset-user="${user.id}" data-reset-name="${escapeHTML(user.username)}">修改密码</button>${user.isAdmin ? "" : `<button class="button small danger" data-delete-user="${user.id}" data-delete-name="${escapeHTML(user.username)}">删除用户</button>`}</div></div>`).join("");
    } catch (error) { document.getElementById("adminUsers").textContent = error.message; }
  }

  function exportProgress() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), app: "Azure Training Platform", course: activeCourse.code, state }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai103-progress-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.settings.theme;
  }

  document.addEventListener("click", event => {
    const view = event.target.closest("[data-view]")?.dataset.view;
    if (view) return navigate(view);
    const resetUser = event.target.closest("[data-reset-user]");
    if (resetUser) { const password = prompt(`为 ${resetUser.dataset.resetName} 设置新密码（至少 6 位）`); if (password) QuizAuth.changePassword(Number(resetUser.dataset.resetUser), password).then(() => toast("密码已修改")).catch(error => toast(error.message)); return; }
    const deleteUser = event.target.closest("[data-delete-user]");
    if (deleteUser) {
      const username = deleteUser.dataset.deleteName;
      if (!confirm(`确定删除用户“${username}”吗？该用户的学习进度和登录会话也会永久删除。`)) return;
      deleteUser.disabled = true;
      QuizAuth.deleteUser(Number(deleteUser.dataset.deleteUser))
        .then(() => { toast(`用户“${username}”已删除`); renderAdmin(); })
        .catch(error => { deleteUser.disabled = false; toast(error.message); });
      return;
    }
    if (event.target.closest("[data-action='start-all']")) return startPractice("all");
    const mode = event.target.closest("[data-start-mode]")?.dataset.startMode;
    if (mode) return startPractice(mode);
    const option = event.target.closest("[data-option]")?.dataset.option;
    if (option) return chooseOption(option);
    const clearInput = event.target.closest("[data-clear-input]")?.dataset.clearInput;
    if (clearInput) return setVisualInputValue(clearInput, "");
    const dragChoice = event.target.closest("[data-drag-choice]")?.dataset.dragChoice;
    if (dragChoice) {
      activeDragChoice = dragChoice;
      content.querySelectorAll("[data-drag-choice]").forEach(item => item.classList.toggle("active", item.dataset.dragChoice === dragChoice));
      return;
    }
    const dropInput = event.target.closest("[data-drop-input]")?.dataset.dropInput;
    if (dropInput && activeDragChoice) {
      const value = activeDragChoice;
      activeDragChoice = "";
      return setVisualInputValue(dropInput, value);
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "prev") return moveQuestion(-1);
    if (action === "next") return moveQuestion(1);
    if (action === "submit") return submitCurrent();
    if (action === "retry") return retryCurrent();
    if (action === "bookmark") return toggleBookmark();
    if (action === "show-source") return showSource(questionMap.get(currentQueue[currentIndex]));
    if (action === "jump") {
      const value = Number(document.getElementById("jumpInput")?.value);
      const id = questions.find(question => question.number === value)?.id;
      if (questionMap.has(id)) startPractice("all", id); else toast(`请输入 1 到 ${questions.length} 之间的题号`);
      return;
    }
    if (action === "export") return exportProgress();
    if (action === "import") return importInput.click();
    if (action === "reset") {
      if (confirm("确定清空全部学习记录吗？此操作无法撤销。")) {
        state = structuredClone(defaultState); scheduleSave(); applyTheme(); renderSettings(); toast("学习记录已清空");
      }
      return;
    }
    const answerPage = event.target.closest("[data-answer-card-page]")?.dataset.answerCardPage;
    if (answerPage !== undefined) {
      answerCardPage = Number(answerPage);
      return renderPractice(false);
    }
    const self = event.target.closest("[data-self]")?.dataset.self;
    if (self) return submitCurrent(self === "correct");
    const queueIndex = event.target.closest("[data-queue-index]")?.dataset.queueIndex;
    if (queueIndex !== undefined) { currentIndex = Number(queueIndex); renderPractice(); return; }
    const questionId = event.target.closest("[data-open-question]")?.dataset.openQuestion;
    if (questionId) return startPractice("all", questionId);
    const caseId = event.target.closest("[data-show-case]")?.dataset.showCase;
    if (caseId) return showCase(caseId);
    const caseImages = event.target.closest("[data-show-case-images]")?.dataset.showCaseImages;
    if (caseImages) return showCaseImages(caseImages);
    const startCaseId = event.target.closest("[data-start-case]")?.dataset.startCase;
    if (startCaseId) { modal.hidden = true; currentQueue = caseMap.get(startCaseId).questionIds; currentIndex = 0; currentView = "practice"; return renderPractice(); }
    const listMode = event.target.closest("[data-start-list]")?.dataset.startList;
    if (listMode) {
      currentQueue = (content.dataset.listIds || "").split(",").filter(Boolean);
      if (!currentQueue.length) return toast("当前列表为空");
      currentIndex = 0; currentView = "practice"; return renderPractice();
    }
  });

  content.addEventListener("dragstart", event => {
    const choice = event.target.closest("[data-drag-choice]")?.dataset.dragChoice;
    if (!choice) return;
    activeDragChoice = choice;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", choice);
    event.target.classList.add("dragging");
  });

  content.addEventListener("dragend", event => {
    event.target.closest("[data-drag-choice]")?.classList.remove("dragging");
    content.querySelectorAll(".drop-zone.drag-over").forEach(zone => zone.classList.remove("drag-over"));
  });

  content.addEventListener("dragover", event => {
    const zone = event.target.closest("[data-drop-input]");
    if (!zone) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    zone.classList.add("drag-over");
  });

  content.addEventListener("dragleave", event => {
    const zone = event.target.closest("[data-drop-input]");
    if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove("drag-over");
  });

  content.addEventListener("drop", event => {
    const zone = event.target.closest("[data-drop-input]");
    if (!zone) return;
    event.preventDefault();
    const value = event.dataTransfer.getData("text/plain") || activeDragChoice;
    activeDragChoice = "";
    if (value) setVisualInputValue(zone.dataset.dropInput, value);
  });

  content.addEventListener("keydown", event => {
    const zone = event.target.closest("[data-drop-input]");
    if (!zone || !activeDragChoice || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    const value = activeDragChoice;
    activeDragChoice = "";
    setVisualInputValue(zone.dataset.dropInput, value);
  });

  content.addEventListener("input", event => {
    if (event.target.matches("[data-visual-input]")) {
      const question = questionMap.get(currentQueue[currentIndex]);
      const record = answeredRecord(question.id);
      const prefix = `${event.target.dataset.visualInput}:`;
      const selected = (record.selected || []).filter(token => !token.startsWith(prefix));
      selected.push(`${prefix}${event.target.value}`);
      state.answers[question.id] = { ...record, selected };
      scheduleSave();
      const submit = content.querySelector("[data-action='submit']");
      if (submit) submit.disabled = !canSubmit(question, selected);
      return;
    }
    if (event.target.matches("[data-note-id]")) {
      state.notes[event.target.dataset.noteId] = event.target.value;
      scheduleSave();
    }
    if (event.target.id === "listSearch") renderQuestionBrowser({ view: currentView, query: event.target.value, type: document.getElementById("typeFilter")?.value, status: document.getElementById("statusFilter")?.value });
  });

  content.addEventListener("change", event => {
    if (event.target.matches("select[data-visual-input]")) {
      event.target.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (["typeFilter", "statusFilter"].includes(event.target.id)) renderQuestionBrowser({ view: currentView, query: document.getElementById("listSearch")?.value, type: document.getElementById("typeFilter")?.value, status: document.getElementById("statusFilter")?.value });
    if (event.target.id === "languageSetting") { state.settings.language = event.target.value; scheduleSave(); }
    if (event.target.id === "shuffleSetting") { state.settings.shuffle = event.target.checked; scheduleSave(); }
  });

  document.getElementById("globalSearch").addEventListener("keydown", event => {
    if (event.key === "Enter") renderQuestionBrowser({ view: "questions", query: event.target.value.trim() });
  });
  document.getElementById("menuButton").addEventListener("click", () => sidebar.classList.toggle("open"));
  document.getElementById("themeToggle").addEventListener("click", () => { state.settings.theme = state.settings.theme === "dark" ? "light" : "dark"; applyTheme(); scheduleSave(); });
  document.querySelectorAll("[data-auth-tab]").forEach(button => button.addEventListener("click", () => {
    authMode = button.dataset.authTab;
    document.querySelectorAll("[data-auth-tab]").forEach(item => item.classList.toggle("active", item === button));
    document.getElementById("confirmPasswordRow").hidden = authMode !== "register";
    document.getElementById("authSubmit").textContent = authMode === "register" ? "注册并登录" : "登录";
    document.getElementById("authError").textContent = "";
  }));
  document.getElementById("authForm").addEventListener("submit", async event => {
    event.preventDefault();
    const username = document.getElementById("authUsername").value.trim();
    const password = document.getElementById("authPassword").value;
    const error = document.getElementById("authError");
    if (authMode === "register" && password !== document.getElementById("authPasswordConfirm").value) { error.textContent = "两次输入的密码不一致"; return; }
    error.textContent = "";
    try { const result = await QuizAuth[authMode](username, password); if (!localStorage.getItem("azure-training-course")) showCourseEntry(); else await enterApp(result.user); }
    catch (exception) { error.textContent = exception.message; }
  });
  document.getElementById("logoutButton").addEventListener("click", async () => {
    clearTimeout(saveTimer); await QuizAuth.logout(); currentUser = null; state = structuredClone(defaultState);
    localStorage.removeItem("azure-training-course"); appShell.hidden = true; courseEntryScreen.hidden = true; authScreen.hidden = false; document.getElementById("authForm").reset();
  });
  document.getElementById("modalClose").addEventListener("click", () => modal.hidden = true);
  modal.addEventListener("click", event => { if (event.target === modal) modal.hidden = true; });
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      state = mergeState(payload.state || payload);
      scheduleSave(); applyTheme(); renderSettings(); toast("学习记录已恢复");
    } catch { toast("无法读取这个备份文件"); }
    importInput.value = "";
  });

  document.addEventListener("keydown", event => {
    if (modal.hidden === false || ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) || currentView !== "practice") return;
    if (event.key === "ArrowLeft") moveQuestion(-1);
    if (event.key === "ArrowRight") moveQuestion(1);
    if (/^[1-8]$/.test(event.key)) {
      const q = questionMap.get(currentQueue[currentIndex]);
      const option = q.options[Number(event.key) - 1];
      if (option) chooseOption(option.id);
    }
    if (event.key === "Enter") submitCurrent();
  });

  async function enterApp(user) {
    currentUser = user;
    document.getElementById("currentUsername").textContent = user.username;
    document.querySelectorAll(".admin-only").forEach(item => item.hidden = !user.isAdmin);
    state = mergeState(await QuizDB.get("progress"));
    applyTheme();
    authScreen.hidden = true; courseEntryScreen.hidden = true; appShell.hidden = false;
    renderDashboard();
  }

  async function init() {
    const session = await QuizAuth.me();
    if (session.authenticated) {
      if (!localStorage.getItem("azure-training-course")) showCourseEntry();
      else await enterApp(session.user);
    }
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").then(registration => registration.update()).catch(() => {});
    }
  }

  courseSelector?.addEventListener("change", event => switchCourse(event.target.value));
  courseEntryGrid?.addEventListener("click", event => { const button = event.target.closest("[data-entry-course]"); if (button) enterSelectedCourse(button.dataset.entryCourse); });
  renderCourseSelector();
  init();
})();
