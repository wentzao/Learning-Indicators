(() => {
  'use strict';
  const DATA_URL = 'data/learning_indicators.json';
  const AGE_CODES = { '2-3歲': '幼', '3-4歲': '小', '4-5歲': '中', '5-6歲': '大' };
  const AGES = Object.keys(AGE_CODES);
  const mobileLayout = window.matchMedia('(max-width: 860px)');
  const app = document.getElementById('app');
  const nav = document.getElementById('domainLinks');
  const clipboard = document.getElementById('clipboardModal');
  let selectedAge = mobileLayout.matches ? AGES[0] : 'all';
  let domainSections = [];
  let clipboardHistory = [];
  let toastTimer;
  let scrollUpdatePending = false;
  let navigationTarget = null;
  let navigationSettleTimer;
  let loaded = false;

  if (window.self !== window.top) document.body.classList.add('in-iframe');

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function scrollTo(element, block = 'start') {
    element.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block });
  }

  // Arrow entries inherit the nearest earlier non-empty description, while
  // retaining the code for the age the teacher actually selected.
  function resolveIndicator(indicator, age, ageHeaders) {
    const raw = (indicator.ages?.[age] || '').trim();
    if (!raw) return null;
    const continued = raw === '⟶';
    let description = raw;
    if (continued) {
      description = '';
      for (let i = ageHeaders.indexOf(age) - 1; i >= 0; i--) {
        const previous = (indicator.ages?.[ageHeaders[i]] || '').trim();
        if (previous && previous !== '⟶') { description = previous; break; }
      }
    }
    const code = (indicator.code || '').replace(/[幼小中大](\/[幼小中大])*/, AGE_CODES[age] || '');
    return { code, description, continued, text: [code, description].filter(Boolean).join('\n') };
  }

  function buildGoalDescriptionMap(summary) {
    const map = {};
    for (const row of summary?.rows || []) {
      for (const cell of row.cells || []) {
        for (const item of cell || []) {
          if (item.goal && !(item.goal in map)) map[item.goal] = item.description || '';
        }
      }
    }
    return map;
  }

  function renderSummaryCell(cellItems) {
    const td = node('td');
    if (!Array.isArray(cellItems) || !cellItems.length) { td.className = 'empty-cell'; return td; }
    if (cellItems[0].colspan > 1) td.colSpan = cellItems[0].colspan;
    if (cellItems[0].rowspan > 1) td.rowSpan = cellItems[0].rowspan;
    for (const item of cellItems) {
      const wrapper = node(item.goal ? 'a' : 'div', 'summary-cell-item' + (item.goal ? ' goal-link' : ''));
      if (item.goal) {
        wrapper.href = `#goal-${item.goal}`;
        wrapper.append(node('span', 'goal-code', item.goal));
        wrapper.addEventListener('click', (event) => {
          event.preventDefault();
          const prefix = mobileLayout.matches ? 'mobile-goal-' : 'goal-';
          const target = document.getElementById(prefix + item.goal);
          if (!target) return;
          scrollTo(target, mobileLayout.matches ? 'start' : 'center');
          target.setAttribute('tabindex', '-1');
          target.focus({ preventScroll: true });
          target.classList.add('highlight-goal');
          setTimeout(() => target.classList.remove('highlight-goal'), 1800);
        });
      }
      if (item.description) wrapper.append(node('span', 'goal-desc', item.description));
      td.append(wrapper);
    }
    return td;
  }

      function renderSummaryTable(summary) {
        const table = document.createElement('table');
        table.className = 'summary-table';

        const headers = Array.isArray(summary.headers) ? summary.headers : [];
        const rows = Array.isArray(summary.rows) ? summary.rows : [];

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        headers.forEach((header, index) => {
          const th = document.createElement('th');

          // 第一個表頭單元格使用對角線樣式
          if (index === 0) {
            th.className = 'diagonal-header';
            // 處理表頭文字，預期格式為 "學習面向\n領域能力" 或包含 <br>
            const headerText = header || '';
            // 分隔換行符或 <br> 標籤
            const lines = headerText
              .split(/\n|<br\s*\/?>/i)
              .map(line => line.trim())
              .filter(line => line);

            if (lines.length >= 2) {
              // 有兩行文字，使用對角線佈局
              // 第一行放右上角（學習面向）
              const topRight = document.createElement('span');
              topRight.className = 'top-right';
              topRight.textContent = lines[0];

              // 第二行放左下角（領域能力）
              const bottomLeft = document.createElement('span');
              bottomLeft.className = 'bottom-left';
              bottomLeft.textContent = lines[1];

              th.appendChild(topRight);
              th.appendChild(bottomLeft);
            } else {
              // 只有一行或沒有文字，直接顯示
              th.innerHTML = headerText;
            }
          } else {
            th.innerHTML = header || '';
          }

          headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');

        // 計算每個能力需要的 rowspan
        const abilityCounts = [];
        let currentAbility = null;
        let currentCount = 0;

        rows.forEach((row, index) => {
          const ability = row.ability || '';

          if (ability && ability !== currentAbility) {
            // 新的能力開始
            if (currentAbility !== null) {
              abilityCounts.push({ ability: currentAbility, count: currentCount, startIndex: index - currentCount });
            }
            currentAbility = ability;
            currentCount = 1;
          } else if (!ability && currentAbility) {
            // 空能力，屬於上一個能力的延續
            currentCount++;
          } else if (ability) {
            // 相同能力
            currentCount++;
          }

          // 最後一行
          if (index === rows.length - 1 && currentAbility !== null) {
            abilityCounts.push({ ability: currentAbility, count: currentCount, startIndex: index - currentCount + 1 });
          }
        });

        // 追蹤每個欄位被 rowspan 佔用的情況
        // rowspanTracker[colIndex] = 剩餘要跳過的行數
        const rowspanTracker = {};

        rows.forEach((row, rowIndex) => {
          const tr = document.createElement('tr');

          // 檢查這一行是否需要渲染能力單元格
          const abilityInfo = abilityCounts.find(info => info.startIndex === rowIndex);
          if (abilityInfo) {
            const abilityTd = document.createElement('td');
            abilityTd.className = 'ability-cell';
            abilityTd.textContent = abilityInfo.ability;
            if (abilityInfo.count > 1) {
              abilityTd.setAttribute('rowspan', abilityInfo.count);
            }
            tr.appendChild(abilityTd);
          } else if (!row.ability) {
            // 如果這行沒有能力且不是起始行，不添加能力單元格（被 rowspan 覆蓋）
          } else if (row.ability) {
            // 有能力但不是起始行，說明是新的能力組
            const abilityTd = document.createElement('td');
            abilityTd.className = 'ability-cell';
            abilityTd.textContent = row.ability;
            tr.appendChild(abilityTd);
          }

          // 計算實際需要渲染的欄位數（包括被 colspan 展開的）
          let totalColumns = headers.length - 1; // 減去能力欄
          let dataColIndex = 0; // JSON 中的欄位索引
          let renderColIndex = 0; // 實際要渲染的欄位位置（考慮被 rowspan 佔用的）

          while (renderColIndex < totalColumns && dataColIndex < (Array.isArray(row.cells) ? row.cells.length : 0)) {
            // 檢查這個欄位是否被上一行的 rowspan 佔用
            if (rowspanTracker[renderColIndex] && rowspanTracker[renderColIndex] > 0) {
              // 這個欄位被佔用，跳過渲染但要檢查 JSON 數據
              // JSON 中對應位置應該是空陣列
              rowspanTracker[renderColIndex]--;
              renderColIndex++;
              dataColIndex++; // 同時增加 dataColIndex，因為 JSON 中這個位置是空陣列
              continue;
            }

            // 渲染這個欄位
            const cellItems = Array.isArray(row.cells) && row.cells[dataColIndex] ? row.cells[dataColIndex] : [];
            const td = renderSummaryCell(cellItems);
            tr.appendChild(td);

            // 檢查是否有 rowspan，如果有就記錄
            if (cellItems[0] && cellItems[0].rowspan && cellItems[0].rowspan > 1) {
              const rowspanValue = cellItems[0].rowspan;
              // 記錄這個欄位在接下來的 (rowspan - 1) 行要被跳過
              rowspanTracker[renderColIndex] = rowspanValue - 1;
            }

            // 如果這個單元格有 colspan，跳過後續被佔據的欄位
            let colspanValue = 1;
            if (cellItems[0] && cellItems[0].colspan && cellItems[0].colspan > 1) {
              colspanValue = cellItems[0].colspan;
              renderColIndex += colspanValue;
            } else {
              renderColIndex++;
            }

            dataColIndex++;
          }

          tbody.appendChild(tr);
        });
        table.appendChild(tbody);

        return table;
      }



  function renderDomain(domain, index) {
    const section = node('section', 'domain-section');
    section.id = `domain-${index}`;
    const heading = node('h2', 'domain-title', domain.title || domain.name);
    heading.id = `domain-heading-${index}`;
    section.setAttribute('aria-labelledby', heading.id);
    section.append(heading);
    const descriptions = buildGoalDescriptionMap(domain.summary);
    if (domain.summary) {
      const overview = node('details', 'goal-overview');
      const summary = node('summary', '', '課程目標總覽');
      summary.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
      const region = node('div', 'table-scroll');
      region.tabIndex = 0;
      region.setAttribute('role', 'region');
      region.setAttribute('aria-label', `${domain.title}課程目標總覽，可左右捲動`);
      const summaryTable = renderSummaryTable(domain.summary);
      summaryTable.setAttribute('aria-label', `${domain.title}課程目標總覽`);
      region.append(summaryTable);
      overview.append(summary, region);
      section.append(overview);
    }
    const desktop = node('div', 'table-scroll desktop-indicators');
    desktop.tabIndex = 0;
    desktop.setAttribute('role', 'region');
    desktop.setAttribute('aria-label', `${domain.title}各年齡層學習指標，可左右捲動`);
    desktop.append(renderDetailTable(domain.details || {}, descriptions, domain.title));
    const mobile = node('div', 'mobile-indicators');
    section.append(desktop, mobile);
    const entry = { name: domain.title || domain.name, element: section, domain, descriptions, mobile };
    renderMobileIndicators(entry);
    return entry;
  }

  function appendIndicator(container, value) {
    if (value.code) container.append(node('span', 'indicator-code', value.code));
    const description = node('div', 'indicator-desc', value.description || '延續前齡指標');
    if (value.continued) {
      const continuation = node('details', 'continuation');
      const arrow = node('summary', '', '⟶');
      arrow.setAttribute('aria-label', `${value.code}：延續前齡指標，查看完整內容`);
      arrow.title = '延續前齡指標，點選查看完整內容';
      continuation.append(arrow, description);
      container.append(continuation);
    } else {
      container.append(description);
    }
    container.append(createCopyButton(value.text, value.code));
  }

  function renderDetailTable(details, descriptions, title) {
    const table = node('table', 'detail-table');
    table.setAttribute('aria-label', `${title}各年齡層學習指標`);
    const headers = details.ageHeaders || [];
    const head = node('thead');
    const row = node('tr');
    const goalHeader = node('th', '', '課程目標');
    goalHeader.scope = 'col';
    row.append(goalHeader);
    for (const age of headers) {
      const th = node('th', 'age-header', age.replace('-', '–'));
      th.scope = 'col';
      th.dataset.age = age;
      row.append(th);
    }
    head.append(row);
    table.append(head);
    const body = node('tbody');
    for (const goal of details.goals || []) {
      const indicators = goal.indicators || [];
      indicators.forEach((indicator, index) => {
        const tr = node('tr', index === indicators.length - 1 ? 'goal-group-last' : '');
        if (index === 0) {
          const td = node('td', 'goal-col');
          td.id = `goal-${goal.goalId}`;
          td.rowSpan = indicators.length;
          td.append(node('span', 'goal-code', goal.goalId));
          td.append(node('span', 'goal-desc', descriptions[goal.goalId] || ''));
          tr.append(td);
        }
        for (const age of headers) {
          const td = node('td', 'desc-col');
          td.dataset.age = age;
          const value = resolveIndicator(indicator, age, headers);
          if (value) appendIndicator(td, value);
          else { td.classList.add('empty-cell'); td.append(node('span', 'empty-dash', '—')); }
          tr.append(td);
        }
        body.append(tr);
      });
    }
    table.append(body);
    return table;
  }

  function renderMobileIndicators(entry) {
    entry.mobile.replaceChildren();
    const details = entry.domain.details || {};
    const headers = details.ageHeaders || [];
    const ages = selectedAge === 'all' ? headers : [selectedAge];
    for (const goal of details.goals || []) {
      const group = node('section', 'mobile-goal');
      group.id = `mobile-goal-${goal.goalId}`;
      const heading = node('h4');
      heading.append(node('span', 'goal-code', goal.goalId), document.createTextNode(' ' + (entry.descriptions[goal.goalId] || '')));
      group.append(heading);
      let count = 0;
      for (const age of ages) {
        const values = (goal.indicators || []).map(indicator => resolveIndicator(indicator, age, headers)).filter(Boolean);
        if (!values.length) continue;
        if (selectedAge === 'all') group.append(node('h5', 'mobile-age-title', age.replace('-', '–')));
        for (const value of values) {
          const indicator = node('div', 'mobile-indicator');
          appendIndicator(indicator, value);
          group.append(indicator);
          count++;
        }
      }
      if (!count) group.append(node('p', 'mobile-empty', '此年齡尚未列有本項指標。'));
      entry.mobile.append(group);
    }
  }

  function setAge(age, announce = true) {
    selectedAge = age;
    document.querySelectorAll('.age-controls button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.age === age)));
    document.querySelectorAll('.detail-table [data-age]').forEach(cell => { cell.hidden = age !== 'all' && cell.dataset.age !== age; });
    document.querySelectorAll('.detail-table').forEach(table => table.classList.toggle('filtered', age !== 'all'));
    domainSections.forEach(renderMobileIndicators);
    requestAnimationFrame(updateCurrentDomain);
    if (announce) document.getElementById('filterStatus').textContent = age === 'all' ? '顯示全部年齡學習指標' : `顯示${age}學習指標`;
  }

  function initAgeFilters() {
    const controls = document.getElementById('ageFilters');
    controls.replaceChildren();
    for (const age of ['all', ...AGES]) {
      const button = node('button', '', age === 'all' ? '全部' : age.replace('-', '–'));
      button.type = 'button';
      button.dataset.age = age;
      button.setAttribute('aria-label', age === 'all' ? '全部年齡' : age.replace('-', '–'));
      button.setAttribute('aria-pressed', String(selectedAge === age));
      button.addEventListener('click', () => setAge(age));
      controls.append(button);
    }
  }

  function setCurrentDomain(index) {
    document.getElementById('domainNav').value = String(index);
    nav.querySelectorAll('a').forEach((link, i) => {
      if (i === index) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  function updateCurrentDomain() {
    if (!domainSections.length || navigationTarget !== null) return;
    const sidebar = document.querySelector('.sidebar');
    const readingLine = mobileLayout.matches
      ? sidebar.getBoundingClientRect().bottom + 32
      : Math.min(160, window.innerHeight * .25);
    let current = 0;
    domainSections.forEach((entry, index) => {
      if (entry.element.getBoundingClientRect().top <= readingLine) current = index;
    });
    setCurrentDomain(current);
  }

  function scheduleScrollUpdate() {
    if (navigationTarget !== null) {
      scheduleNavigationFinish();
      return;
    }
    if (scrollUpdatePending) return;
    scrollUpdatePending = true;
    requestAnimationFrame(() => {
      updateCurrentDomain();
      scrollUpdatePending = false;
    });
  }

  function finishDomainNavigation() {
    clearTimeout(navigationSettleTimer);
    navigationTarget = null;
    updateCurrentDomain();
  }

  function scheduleNavigationFinish() {
    clearTimeout(navigationSettleTimer);
    // Release after scrolling settles, including browsers without scrollend
    // and clicks on an already aligned section that produce no scroll event.
    navigationSettleTimer = setTimeout(finishDomainNavigation, 180);
  }

  function navigateToDomain(index) {
    const entry = domainSections[index];
    if (!entry) return;
    navigationTarget = index;
    setCurrentDomain(index);
    scrollTo(entry.element);
    scheduleNavigationFinish();
  }

  function interruptDomainNavigation() {
    if (navigationTarget === null) return;
    window.scrollTo({ top: window.scrollY, left: window.scrollX, behavior: 'auto' });
    finishDomainNavigation();
  }

  function initNavigation() {
    const select = document.getElementById('domainNav');
    nav.replaceChildren();
    select.replaceChildren();
    domainSections.forEach((entry, index) => {
      const link = node('a', '', entry.name);
      link.href = `#domain-${index}`;
      link.addEventListener('click', event => {
        event.preventDefault();
        navigateToDomain(index);
      });
      nav.append(link);
      const option = node('option', '', entry.name);
      option.value = index;
      select.append(option);
    });
    setCurrentDomain(0);
    select.disabled = false;
  }

  async function copyToClipboard(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* iframe/older browser fallback */ }
    const active = document.activeElement;
    const textarea = node('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;';
    textarea.setAttribute('readonly', '');
    // A modal dialog makes the rest of the document inert, so the fallback
    // must live inside the open dialog in order to receive selection/focus.
    (document.querySelector('dialog[open]') || document.body).append(textarea);
    try {
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      return document.execCommand('copy');
    } catch { return false; }
    finally { textarea.remove(); active?.focus({ preventScroll: true }); }
  }

  function createCopyButton(text, code) {
    const button = node('button', 'copy-button');
    button.type = 'button';
    button.title = '複製指標';
    button.setAttribute('aria-label', `複製 ${code || '指標'}`);
    button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="8" y="3" width="12" height="15" rx="2"/><path d="M16 18v3H4V7h4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    button.addEventListener('click', async () => {
      if (!await copyToClipboard(text)) { showToast('複製失敗，請稍後再試'); return; }
      if (!clipboardHistory.includes(text)) clipboardHistory.push(text);
      updateClipboardUI();
      button.classList.add('copied');
      setTimeout(() => button.classList.remove('copied'), 1200);
      showToast('已複製到剪貼簿');
    });
    return button;
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; toast.textContent = ''; }, 3000);
  }

  function updateClipboardUI() {
    const hasItems = clipboardHistory.length > 0;
    document.getElementById('clipboardCount').textContent = clipboardHistory.length;
    document.getElementById('copyAllBtn').disabled = !hasItems;
    document.getElementById('clearBtn').disabled = !hasItems;
    const list = document.getElementById('clipboardList');
    list.replaceChildren();
    if (!hasItems) { list.append(node('li', 'clipboard-empty', '尚未複製任何指標')); return; }
    clipboardHistory.forEach((text, index) => {
      const item = node('li');
      const button = node('button', 'clipboard-item', `${index + 1}. ${text}`);
      button.type = 'button';
      button.setAttribute('aria-label', `再次複製 ${text.split('\n')[0]}`);
      button.addEventListener('click', async () => showToast(await copyToClipboard(text) ? '已複製到剪貼簿' : '複製失敗，請稍後再試'));
      item.append(button);
      list.append(item);
    });
  }

  async function init() {
    if (loaded) return;
    app.replaceChildren(node('p', 'status-message', '資料載入中…'));
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.domains) || !data.domains.length) throw new Error('尚未提供學習指標資料');
      domainSections = data.domains.map(renderDomain);
      app.replaceChildren(...domainSections.map(entry => entry.element));
      initNavigation();
      initAgeFilters();
      setAge(selectedAge, false);
      loaded = true;
    } catch (error) {
      const status = node('div', 'status-message status-error', `資料載入失敗：${error.message}`);
      status.setAttribute('role', 'alert');
      const retry = node('button', 'retry-button', '重新載入');
      retry.addEventListener('click', init);
      status.append(retry);
      app.replaceChildren(status);
    }
  }

  document.getElementById('domainNav').addEventListener('change', event => {
    navigateToDomain(Number(event.target.value));
  });
  document.getElementById('clipboardBtn').addEventListener('click', () => { updateClipboardUI(); clipboard.showModal(); });
  document.getElementById('closeClipboardBtn').addEventListener('click', () => clipboard.close());
  clipboard.addEventListener('click', event => {
    if (event.target !== clipboard) return;
    const rect = clipboard.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) clipboard.close();
  });
  document.getElementById('copyAllBtn').addEventListener('click', async () => {
    if (!clipboardHistory.length) return;
    showToast(await copyToClipboard(clipboardHistory.join('\n\n')) ? `已複製 ${clipboardHistory.length} 個指標` : '複製失敗，請稍後再試');
  });
  const confirmation = document.getElementById('confirmModal');
  window.addEventListener('scroll', scheduleScrollUpdate, { passive: true });
  window.addEventListener('resize', scheduleScrollUpdate);
  window.addEventListener('wheel', interruptDomainNavigation, { passive: true });
  window.addEventListener('touchmove', interruptDomainNavigation, { passive: true });
  window.addEventListener('keydown', event => {
    if (event.target.closest?.('input, textarea, select, button, [contenteditable]')) return;
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) interruptDomainNavigation();
  });
  document.getElementById('clearBtn').addEventListener('click', () => confirmation.showModal());
  document.getElementById('confirmCancel').addEventListener('click', () => confirmation.close());
  document.getElementById('confirmClear').addEventListener('click', () => {
    clipboardHistory = [];
    updateClipboardUI();
    confirmation.close();
    showToast('已清空已複製的指標');
  });
  updateClipboardUI();
  init();
})();
