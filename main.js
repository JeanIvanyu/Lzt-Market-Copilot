// ==UserScript==
// @name         LZT Market Copilot
// @namespace    https://lzt.market/
// @version      1.0.0
// @description  Анализирует цену лотов LZT Market
// @author       jeanivanyu
// @match        https://lzt.market/*
// @run-at       document-idle
// @connect      prod-api.lzt.market
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
  'use strict';

  const TOKEN_KEY = 'lzt-market-copilot-token';
  const AUTO_ANALYZE_KEY = 'lzt-market-copilot-auto-analyze';
  const AUTO_DETECT_LIST_KEY = 'lzt-market-copilot-auto-detect-list';
  const DEBUG_MODE_KEY = 'lzt-market-copilot-debug-mode';
  const API_BASE = 'https://prod-api.lzt.market';
  const PANEL_ID = 'lzt-copilot-panel';
  const LIST_PANEL_ID = 'lzt-copilot-list-panel';
  const SETTINGS_PARAM = 'copilot-settings';
  const TARGET_COMPARABLES = 30;
  const EXTENDED_COMPARABLES = 50;
  const MAX_CANDIDATES = 120;
  const LIST_ANALYZE_CONCURRENCY = 2;
  const STRICT_GAME_FILTER_LIMIT = 20;
  const RELAXED_GAME_FILTER_LIMIT = 6;
  const STEAM_SCORE_GAME_LIMIT = 8;
  const MIN_STRICT_GAME_FILTER_LIMIT = 2;
  const MINECRAFT_MIN_SCORE = 24;
  const FORTNITE_MIN_SCORE = 28;
  const ROBLOX_MIN_SCORE = 26;
  const RIOT_MIN_SCORE = 28;
  const ITEM_DATA_CACHE = new Map();
  const ANALYSIS_CACHE = new Map();
  const ANALYSIS_META_CACHE = new Map();
  const PAGE_STATE = {
    lastHref: '',
    listAutoRunKey: '',
    routeSyncScheduled: false,
    observerStarted: false
  };

  const CATEGORY_BY_ID = {
    1: 'steam',
    2: 'uplay',
    3: 'origin',
    4: 'socialclub',
    5: 'warface',
    6: 'wot',
    7: 'wot-blitz',
    8: 'minecraft',
    9: 'fortnite',
    10: 'telegram',
    11: 'supercell',
    12: 'epicgames',
    13: 'riot',
    14: 'lol',
    15: 'valorant',
    16: 'gifts',
    17: 'escape-from-tarkov',
    18: 'discord',
    19: 'roblox',
    20: 'tiktok',
    21: 'instagram',
    22: 'battlenet',
    23: 'llm',
    24: 'telegram',
    25: 'llm',
    26: 'mihoyo',
    27: 'vpn',
    28: 'minecraft'
  };

  const CATEGORY_LABEL_MAP = {
    steam: 'steam',
    telegram: 'telegram',
    fortnite: 'fortnite',
    'riot games': 'riot',
    ea: 'ea',
    'ubisoft connect (uplay)': 'uplay',
    minecraft: 'minecraft',
    supercell: 'supercell',
    roblox: 'roblox',
    'world of tanks': 'world-of-tanks',
    'world of tanks blitz': 'wot-blitz',
    'epic games': 'epicgames',
    subscriptions: 'gifts',
    gifts: 'gifts',
    'escape from tarkov': 'escape-from-tarkov',
    'social club': 'socialclub',
    discord: 'discord',
    tiktok: 'tiktok',
    instagram: 'instagram',
    'battle.net': 'battlenet',
    llm: 'llm',
    mihoyo: 'mihoyo',
    vpn: 'vpn',
    warface: 'warface',
    hytale: 'hytale'
  };

  const SUPPORTED_CATEGORY_LABELS = {
    steam: 'Steam',
    minecraft: 'Minecraft',
    fortnite: 'Fortnite',
    roblox: 'Roblox',
    riot: 'Riot Games',
    valorant: 'Valorant',
    lol: 'League of Legends'
  };

  init();

  function init() {
    startPageObserver();
    injectStyles();
    injectSidebarLink();
    syncPageUI();
  }

  function syncPageUI() {
    if (isSettingsPage()) {
      renderSettingsPage();
      return;
    }

    if (isItemPage()) {
      const itemData = parseCurrentItem();
      if (itemData) {
        injectPanel(itemData);
      }
      return;
    }

    if (isItemsListPage()) {
      injectItemsListPanel();
      maybeRunItemsListAutoDetect();
    }
  }

  function startPageObserver() {
    if (PAGE_STATE.observerStarted) {
      return;
    }

    PAGE_STATE.observerStarted = true;
    PAGE_STATE.lastHref = window.location.href;

    const scheduleSync = () => {
      if (PAGE_STATE.routeSyncScheduled) {
        return;
      }

      PAGE_STATE.routeSyncScheduled = true;
      setTimeout(() => {
        PAGE_STATE.routeSyncScheduled = false;
        const hrefChanged = PAGE_STATE.lastHref !== window.location.href;
        if (hrefChanged) {
          PAGE_STATE.lastHref = window.location.href;
          PAGE_STATE.listAutoRunKey = '';
        }
        syncPageUI();
      }, 80);
    };

    new MutationObserver(() => {
      scheduleSync();
    }).observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    window.addEventListener('popstate', scheduleSync);
    window.addEventListener('hashchange', scheduleSync);
  }

  // Маршруты и состояние настроек
  function isItemPage() {
    return /^\/\d+\/?$/.test(window.location.pathname);
  }

  function isItemsListPage() {
    return /^\/user\/\d+\/items\/?$/.test(window.location.pathname);
  }

  function isSettingsPage() {
    return new URL(window.location.href).searchParams.get(SETTINGS_PARAM) === '1';
  }

  function getSettingsUrl() {
    const url = new URL('/', window.location.origin);
    url.searchParams.set(SETTINGS_PARAM, '1');
    return url.toString();
  }

  function getStoredToken() {
    return (localStorage.getItem(TOKEN_KEY) || '').trim();
  }

  function getTokenHelpHtml() {
    return `
      <div class="lztCopilotHint muted">
        <div>Как получить token:</div>
        <div>1. Создай <a href="https://lolz.live/account/api/client-add" target="_blank" rel="noreferrer">API Client</a>.</div>
        <div>2. Получи <a href="https://lolz.live/account/api/get-token" target="_blank" rel="noreferrer">Access Token</a> с правом <code>market</code>.</div>
        <div>3. Вставь token в поле выше и нажми кнопку сохранения.</div>
      </div>
    `;
  }

  function getTokenSetupMessage() {
    return `Token не настроен. Сначала открой <a href="${escapeHtml(getSettingsUrl())}">страницу настроек Copilot</a> и установи Market API token.`;
  }

  function isDirectCategorySupported(categorySlug) {
    return categorySlug === 'steam'
      || categorySlug === 'minecraft'
      || categorySlug === 'fortnite'
      || categorySlug === 'roblox'
      || isRiotCategory(categorySlug);
  }

  function getCategoryDisplayName(categorySlug) {
    return SUPPORTED_CATEGORY_LABELS[categorySlug] || categorySlug || 'эта категория';
  }

  function getUnsupportedCategoryMessage(categorySlug) {
    return `Для категории "${getCategoryDisplayName(categorySlug)}" точный анализ цены пока не реализован. Copilot пока считает стоимость только для поддерживаемых разделов.`;
  }

  function isAutoAnalyzeEnabled() {
    const value = localStorage.getItem(AUTO_ANALYZE_KEY);
    if (value === null) {
      localStorage.setItem(AUTO_ANALYZE_KEY, '1');
      return true;
    }

    return value === '1';
  }

  function isListAutoDetectEnabled() {
    const value = localStorage.getItem(AUTO_DETECT_LIST_KEY);
    if (value === null) {
      localStorage.setItem(AUTO_DETECT_LIST_KEY, '0');
      return false;
    }

    return value === '1';
  }

  function isDebugModeEnabled() {
    return localStorage.getItem(DEBUG_MODE_KEY) === '1';
  }

  // Стили и кнопка в боковом меню
  function injectStyles() {
    if (document.getElementById(`${PANEL_ID}-styles`)) {
      return;
    }

    const style = document.createElement('style');
    style.id = `${PANEL_ID}-styles`;
    style.textContent = `
      .lztCopilotPanel { margin: 18px 0 0; }
      .lztCopilotPanel .secondaryContent { padding: 16px; }
      .lztCopilotPanel__eyebrow { font-size: 11px; font-weight: 800; letter-spacing: 0.12em; margin-bottom: 6px; text-transform: uppercase; }
      .lztCopilotPanel__title { font-size: 24px; font-weight: 800; margin: 0; }
      .lztCopilotSettingsPage__title { font-size: 28px; font-weight: 800; margin: 0 0 8px; }
      .lztCopilotSettingsPage__text { margin: 0 0 18px; }
      .lztCopilotRow { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) auto; }
      .lztCopilotField { display: flex; flex-direction: column; gap: 6px; }
      .lztCopilotField label { font-size: 12px; font-weight: 700; }
      .lztCopilotField input { min-height: 36px; }
      .lztCopilotActions { align-items: end; display: flex; }
      .lztCopilotHint { font-size: 12px; line-height: 1.45; margin-top: 10px; }
      .lztCopilotStatus { font-size: 13px; margin-top: 12px; }
      .lztCopilotToggle { margin-top: 12px; }
      .lztCopilotToggle label { align-items: center; display: flex; gap: 8px; }
      .lztCopilotLoader { align-items: center; display: inline-flex; gap: 10px; }
      .lztCopilotLoaderDots { display: inline-flex; gap: 5px; transform: translateY(1px); }
      .lztCopilotLoaderDots span { animation: lztCopilotPulse 1.05s ease-in-out infinite; background: currentColor; border-radius: 999px; display: block; height: 6px; opacity: 0.28; width: 6px; }
      .lztCopilotLoaderDots span:nth-child(2) { animation-delay: 0.14s; }
      .lztCopilotLoaderDots span:nth-child(3) { animation-delay: 0.28s; }
      .lztCopilotNotice { margin-top: 14px; }
      .lztCopilotStats { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 16px; }
      .lztCopilotStat { border-radius: 14px; padding: 14px; }
      .lztCopilotStat__label { font-size: 12px; margin-bottom: 8px; }
      .lztCopilotStat__value { font-size: 24px; font-weight: 800; }
      .lztCopilotVerdict { align-items: center; border-radius: 14px; display: flex; gap: 12px; margin-top: 16px; padding: 14px; }
      .lztCopilotVerdict--lower { border-left: 3px solid #d9534f; }
      .lztCopilotVerdict--raise { border-left: 3px solid #f0ad4e; }
      .lztCopilotVerdict--keep { border-left: 3px solid #63c20f; }
      .lztCopilotVerdict__title { font-size: 15px; font-weight: 800; }
      .lztCopilotVerdict__text { font-size: 13px; margin-top: 4px; }
      .lztCopilotList { margin-top: 16px; }
      .lztCopilotList__title { font-size: 14px; font-weight: 800; margin-bottom: 10px; }
      .lztCopilotTable { border-collapse: collapse; width: 100%; }
      .lztCopilotTable th, .lztCopilotTable td { border-bottom: 1px solid rgba(255, 255, 255, 0.06); padding: 10px 8px; text-align: left; vertical-align: top; }
      .lztCopilotTable th { font-size: 11px; font-weight: 800; text-transform: uppercase; }
      .lztCopilotTable th:last-child, .lztCopilotTable td:last-child { text-align: right; white-space: nowrap; width: 1%; }
      .lztCopilotTable td:first-child a { overflow-wrap: anywhere; word-break: break-word; }
      .lztCopilotListPanel { margin-bottom: 18px; }
      .lztCopilotListCardNote { border-top: 1px solid rgba(255, 255, 255, 0.06); font-size: 12px; line-height: 1.45; margin-top: 10px; padding-top: 10px; }
      .lztCopilotListCardNote strong { font-size: 13px; }
      .lztCopilotListCardMuted { opacity: 0.72; }
      .lztCopilotMetaRow { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; margin-top: 10px; }
      .lztCopilotMetaText { font-size: 12px; opacity: 0.72; }
      .lztCopilotRefreshButton { min-height: 28px; padding: 0 12px; }
      @media (max-width: 980px) {
        .lztCopilotRow, .lztCopilotStats { grid-template-columns: 1fr; }
        .lztCopilotTable { display: block; overflow-x: auto; white-space: nowrap; }
      }
      @keyframes lztCopilotPulse {
        0%, 80%, 100% { opacity: 0.28; transform: translateY(0) scale(0.92); }
        40% { opacity: 1; transform: translateY(-1px) scale(1); }
      }
    `;

    document.head.appendChild(style);
  }

  function injectSidebarLink() {
    const sidebar = document.querySelector('.marketSidebar');
    if (!sidebar || sidebar.querySelector('.lztCopilotSidebarLink')) {
      return;
    }

    const section = document.createElement('div');
    section.className = 'section';
    section.innerHTML = `
      <div class="secondaryContent">
        <a class="button full lztCopilotSidebarLink" href="${escapeHtml(getSettingsUrl())}">Настройки Copilot</a>
      </div>
    `;

    const sections = [...sidebar.querySelectorAll('.section')];
    const referenceSection = sections.find((node) => /Мои аккаунты|Прочее|Настройки Маркета/i.test(cleanText(node.textContent)));
    if (referenceSection) {
      referenceSection.insertAdjacentElement('afterend', section);
      return;
    }

    sidebar.appendChild(section);
  }

  // Страница настроек
  function renderSettingsPage() {
    const mainContent = document.querySelector('.mainContent');
    if (!mainContent) {
      return;
    }

    const savedToken = localStorage.getItem(TOKEN_KEY) || '';
    const autoAnalyze = isAutoAnalyzeEnabled();
    const autoDetectList = isListAutoDetectEnabled();
    const debugMode = isDebugModeEnabled();

    document.title = 'Настройки LZT Market Copilot';
    mainContent.innerHTML = `
      <section class="section lztCopilotPanel lztCopilotSettingsPage">
        <div class="secondaryContent">
          <div class="lztCopilotPanel__eyebrow muted">LZT Market Copilot</div>
          <h1 class="lztCopilotSettingsPage__title">Сохранение Market API token</h1>
          <p class="lztCopilotSettingsPage__text muted">
            Здесь хранится токен для запросов к Market API. Он используется только в браузере для анализа твоих лотов.
          </p>
          <div class="lztCopilotRow">
            <div class="lztCopilotField">
              <label for="lztCopilotSettingsToken">Market API token</label>
              <input id="lztCopilotSettingsToken" class="textCtrl full" type="password" placeholder="Вставь token из account/api/get-token" value="${escapeHtml(savedToken)}" spellcheck="false">
            </div>
            <div class="lztCopilotActions">
              <button id="lztCopilotSaveToken" class="button primary">Сохранить</button>
            </div>
          </div>
          <div class="lztCopilotHint muted">
            Получить токен можно на <a href="https://lzt.market/account/api/get-token" target="_blank" rel="noreferrer">странице выдачи token</a>.
          </div>
          ${getTokenHelpHtml()}
          <div class="lztCopilotNotice secondaryContent lztCopilotToggle">
            <label>
              <input id="lztCopilotAutoAnalyze" type="checkbox" ${autoAnalyze ? 'checked' : ''}>
              <span>Автоанализ при заходе на объявление</span>
            </label>
          </div>
          <div class="lztCopilotNotice secondaryContent lztCopilotToggle">
            <label>
              <input id="lztCopilotAutoDetectList" type="checkbox" ${autoDetectList ? 'checked' : ''}>
              <span>Автоопределение цен в списке лотов</span>
            </label>
          </div>
          <div class="lztCopilotNotice secondaryContent lztCopilotToggle">
            <label>
              <input id="lztCopilotDebugMode" type="checkbox" ${debugMode ? 'checked' : ''}>
              <span>Режим отладки</span>
            </label>
          </div>
          <div id="lztCopilotSettingsStatus" class="lztCopilotStatus muted"></div>
        </div>
      </section>
    `;

    const input = document.getElementById('lztCopilotSettingsToken');
    const button = document.getElementById('lztCopilotSaveToken');
    const status = document.getElementById('lztCopilotSettingsStatus');
    const autoAnalyzeCheckbox = document.getElementById('lztCopilotAutoAnalyze');
    const autoDetectListCheckbox = document.getElementById('lztCopilotAutoDetectList');
    const debugModeCheckbox = document.getElementById('lztCopilotDebugMode');

    button?.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) {
        localStorage.removeItem(TOKEN_KEY);
        status.textContent = 'Настройки сохранены. Token удалён.';
        return;
      }

      localStorage.setItem(TOKEN_KEY, value);
      status.textContent = 'Настройки сохранены. Token сохранён.';
    });

    autoAnalyzeCheckbox?.addEventListener('change', () => {
      localStorage.setItem(AUTO_ANALYZE_KEY, autoAnalyzeCheckbox.checked ? '1' : '0');
      status.textContent = `Настройки сохранены. Автоанализ ${autoAnalyzeCheckbox.checked ? 'включён' : 'выключен'}.`;
    });

    autoDetectListCheckbox?.addEventListener('change', () => {
      localStorage.setItem(AUTO_DETECT_LIST_KEY, autoDetectListCheckbox.checked ? '1' : '0');
      status.textContent = `Настройки сохранены. Автоопределение в списке ${autoDetectListCheckbox.checked ? 'включено' : 'выключено'}.`;
    });

    debugModeCheckbox?.addEventListener('change', () => {
      localStorage.setItem(DEBUG_MODE_KEY, debugModeCheckbox.checked ? '1' : '0');
      status.textContent = `Настройки сохранены. Режим отладки ${debugModeCheckbox.checked ? 'включён' : 'выключен'}.`;
    });
  }

  // Встраивание интерфейса в UI
  function injectPanel(itemData) {
    if (document.getElementById(PANEL_ID)) {
      return;
    }

    const autoAnalyzeEnabled = isAutoAnalyzeEnabled();
    const directSupport = isDirectCategorySupported(itemData.categorySlug);
    const anchor = document.querySelector('.marketItemViewHeadContent') || document.querySelector('.market--titleBar');
    if (!anchor) {
      return;
    }

    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'section lztCopilotPanel';
    panel.innerHTML = `
      <div class="secondaryContent">
        <div class="lztCopilotPanel__eyebrow muted">LZT Market Copilot</div>
        <h2 class="lztCopilotPanel__title">Анализ цены текущего лота</h2>
        <div id="lztCopilotTokenNotice"></div>
        ${!directSupport ? `
        <div class="secondaryContent lztCopilotHint muted">${escapeHtml(getUnsupportedCategoryMessage(itemData.categorySlug))}</div>
        ` : autoAnalyzeEnabled ? '' : `
        <div class="lztCopilotRow">
          <div></div>
          <div class="lztCopilotActions">
            <button id="lztCopilotRun" class="button primary">Проверить цену</button>
          </div>
        </div>
        `}
        <div id="lztCopilotStatus" class="lztCopilotStatus muted"></div>
        <div id="lztCopilotResult"></div>
      </div>
    `;

    anchor.insertAdjacentElement('afterend', panel);

    const runButton = panel.querySelector('#lztCopilotRun');
    runButton?.addEventListener('click', () => runAnalysis(itemData, runButton));
    renderTokenNotice();

    if (directSupport && autoAnalyzeEnabled && getStoredToken()) {
      runAnalysis(itemData, runButton);
    }
  }

  function injectItemsListPanel() {
    const mainContent = document.querySelector('.mainContent');
    if (!mainContent || document.getElementById(LIST_PANEL_ID)) {
      return;
    }

    const panel = document.createElement('section');
    panel.id = LIST_PANEL_ID;
    panel.className = 'section lztCopilotPanel lztCopilotListPanel';
    panel.innerHTML = `
      <div class="secondaryContent">
        <div class="lztCopilotPanel__eyebrow muted">LZT Market Copilot</div>
        <div class="lztCopilotRow">
          <div><div class="lztCopilotList__title" style="margin:0;">Средние цены в списке лотов</div></div>
          <div class="lztCopilotActions">
            <button id="lztCopilotListRun" class="button">Определить цены</button>
          </div>
        </div>
        <div id="lztCopilotListStatus" class="lztCopilotStatus muted"></div>
      </div>
    `;

    mainContent.insertAdjacentElement('afterbegin', panel);
    const button = panel.querySelector('#lztCopilotListRun');
    button?.addEventListener('click', () => runItemsListAnalysis(button));

    if (isListAutoDetectEnabled() && getStoredToken()) {
      runItemsListAnalysis(button);
    }
  }

  function maybeRunItemsListAutoDetect() {
    if (!isListAutoDetectEnabled() || !getStoredToken()) {
      return;
    }

    const button = document.getElementById('lztCopilotListRun');
    if (!button || button.disabled) {
      return;
    }

    const cards = collectItemCards();
    if (!cards.length) {
      return;
    }

    const signature = cards
      .map((card) => parseItemCard(card)?.url || '')
      .filter(Boolean)
      .slice(0, 12)
      .join('|');
    const runKey = `${window.location.pathname}?${window.location.search}::${cards.length}::${signature}`;

    if (PAGE_STATE.listAutoRunKey === runKey) {
      return;
    }

    PAGE_STATE.listAutoRunKey = runKey;
    runItemsListAnalysis(button);
  }

  function renderTokenNotice() {
    const node = document.getElementById('lztCopilotTokenNotice');
    if (!node) {
      return;
    }

    const token = getStoredToken();
    node.innerHTML = token ? '' : `
      <div class="lztCopilotNotice secondaryContent">
        ${getTokenSetupMessage()}
      </div>
    `;
  }

  // Запуск и управление анализом
  async function runAnalysis(itemData, runButton) {
    if (!isDirectCategorySupported(itemData.categorySlug)) {
      setResult(`<div class="secondaryContent lztCopilotHint muted">${escapeHtml(getUnsupportedCategoryMessage(itemData.categorySlug))}</div>`);
      setStatus('Анализ недоступен для этой категории.');
      return;
    }

    const token = getStoredToken();
    if (!token) {
      renderTokenNotice();
      setStatus('Анализ не запущен: token не установлен.');
      return;
    }

    if (runButton) {
      runButton.disabled = true;
    }
    setLoadingState();

    try {
      const analysis = await analyzeItemData(itemData, token);
      renderAnalysis(itemData, analysis, runButton);
      setStatus('');
    } catch (error) {
      console.error('[LZT Market Copilot]', error);
      setResult(`<div class="secondaryContent lztCopilotHint muted">${escapeHtml(error.message || 'Не удалось получить данные из API.')}</div>`);
      setStatus('Анализ не выполнен.');
    } finally {
      if (runButton) {
        runButton.disabled = false;
      }
    }
  }

  async function runItemsListAnalysis(button) {
    const token = getStoredToken();
    if (!token) {
      setListStatus(getTokenSetupMessage());
      return;
    }

    const cards = collectItemCards();
    if (!cards.length) {
      setListStatus('На этой странице не найдено лотов для анализа.');
      return;
    }

    button.disabled = true;
    setListStatus('<span class="lztCopilotLoader">Проверяю цены... <span class="lztCopilotLoaderDots"><span></span><span></span><span></span></span></span>');

    let processed = 0;
    let success = 0;
    const queue = cards.slice();

    const worker = async () => {
      while (queue.length) {
        const card = queue.shift();
        if (!card) {
          break;
        }

        try {
          const analyzed = await analyzeListCard(card, token);
          if (analyzed) {
            success += 1;
          }
        } catch (error) {
          console.error('[LZT Market Copilot] list item failed', error);
          renderListCardError(card, error.message || 'Ошибка анализа');
        } finally {
          processed += 1;
          setListStatus(`Проверяю цены... ${processed}/${cards.length}`);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(LIST_ANALYZE_CONCURRENCY, cards.length) }, () => worker()));
    setListStatus(`Готово: обработано ${success} из ${cards.length}.`);
    button.disabled = false;
  }

  async function analyzeListCard(card, token) {
    renderListCardLoading(card);

    const cardData = parseItemCard(card);
    if (!cardData?.url) {
      throw new Error('Не удалось найти ссылку на лот.');
    }

    const itemData = await fetchItemData(cardData.url);
    if (!itemData?.price || !itemData?.categorySlug) {
      throw new Error('Не удалось разобрать лот.');
    }

    if (!isDirectCategorySupported(itemData.categorySlug)) {
      renderListCardUnsupported(card, itemData.categorySlug);
      return false;
    }

    const analysis = await analyzeItemData(itemData, token);
    renderListCardAnalysis(card, itemData, analysis);
    return true;
  }

  async function analyzeItemData(itemData, token) {
    if (!isDirectCategorySupported(itemData.categorySlug)) {
      throw new Error(getUnsupportedCategoryMessage(itemData.categorySlug));
    }

    const cacheKey = buildAnalysisCacheKey(itemData);
    if (ANALYSIS_CACHE.has(cacheKey)) {
      return ANALYSIS_CACHE.get(cacheKey);
    }

    const analysisPromise = (async () => {
      const comparableData = await loadComparableItems(itemData, token);
      const comparables = comparableData.comparables;
      if (!comparables.length) {
        throw new Error('API не вернуло похожих лотов по текущим фильтрам.');
      }

      const prices = comparables.map((item) => item.price).filter(Number.isFinite);
      const stats = buildStats(prices);
      const result = {
        comparables,
        stats,
        verdict: buildVerdict(itemData.price, stats),
        updatedAt: Date.now(),
        cacheKey,
        debug: comparableData.debug,
        selectionMode: comparableData.selectionMode || 'default'
      };
      ANALYSIS_META_CACHE.set(cacheKey, { updatedAt: result.updatedAt });
      return result;
    })();

    ANALYSIS_CACHE.set(cacheKey, analysisPromise);

    try {
      return await analysisPromise;
    } catch (error) {
      ANALYSIS_CACHE.delete(cacheKey);
      throw error;
    }
  }

  // Разбор данных из DOM
  function parseCurrentItem() {
    return parseItemDocument(document, window.location.href);
  }

  function parseItemDocument(root, itemUrl) {
    const url = new URL(itemUrl, window.location.origin);
    const idMatch = url.pathname.match(/^\/(\d+)\/?$/);
    if (!idMatch) {
      return null;
    }

    const title = cleanText(root.querySelector('.marketItemView--titleStyle .EditableValue, .marketItemView--titleStyle .title-account, .marketItemView--titleStyle')?.textContent);
    const price = Number(root.querySelector('.currentPrice .value')?.getAttribute('data-value') || 0);
    const categorySlug = parseCategorySlug(root);
    const games = extractAccountGames(root, title);
    const structuredInfo = extractStructuredInfoFromDom(root, categorySlug, title);
    const mainInfoText = cleanText(root.querySelector('.marketItemView--mainInfoContainer')?.textContent);
    const statuses = [...root.querySelectorAll('.marketItemView--status .statusTitle')].map((node) => cleanText(node.textContent));
    const badges = [...root.querySelectorAll('.marketItemStatusBadge .badgeText')].map((node) => cleanText(node.textContent)).filter(Boolean);

    return {
      id: idMatch[1],
      title,
      price,
      categorySlug,
      games,
      primaryGames: parseHeadlineGames(title, games),
      analysisGames: games.length ? games : parseHeadlineGames(title, games),
      ...structuredInfo,
      mainInfoText,
      statuses,
      badges,
      url: url.toString()
    };
  }

  function parseItemCard(card) {
    const link = card.querySelector('.marketIndexItem--Title a[href], a.marketIndexItem--Title[href]') || card.querySelector('a[href]');
    const href = link?.getAttribute('href') || '';
    if (!href) {
      return null;
    }

    return {
      title: cleanText(link.textContent),
      url: new URL(href, window.location.origin).toString()
    };
  }

  function extractAccountGames(root, title) {
    const games = new Map();

    const addGame = (game) => {
      const normalizedTitle = cleanText(game?.title);
      const id = game?.id ? String(game.id) : '';
      if (!normalizedTitle || !id) {
        return;
      }

      const key = id;
      if (!games.has(key)) {
        games.set(key, {
          id,
          title: normalizedTitle
        });
      }
    };

    for (const img of root.querySelectorAll('.marketItemView--gamesContainer img[title][src*="/steam/header/"]')) {
      addGame({
        id: extractGameId(img.getAttribute('src') || ''),
        title: img.getAttribute('title') || img.getAttribute('alt') || ''
      });
    }

    const actualGamesHeading = [...root.querySelectorAll('h1, h2, h3, h4, div, span, strong')]
      .find((node) => /^актуальные игры$/i.test(cleanText(node.textContent)));

    if (actualGamesHeading) {
      const sectionRoot = actualGamesHeading.closest('.section, .secondaryContent, article, .block') || actualGamesHeading.parentElement;
      if (sectionRoot) {
        for (const img of sectionRoot.querySelectorAll('img[title][src*="/steam/header/"]')) {
          addGame({
            id: extractGameId(img.getAttribute('src') || ''),
            title: img.getAttribute('title') || img.getAttribute('alt') || ''
          });
        }

        for (const link of sectionRoot.querySelectorAll('a[href*="/app/"], a[href*="store.steampowered.com/app/"]')) {
          const href = link.getAttribute('href') || '';
          const linkText = cleanText(link.textContent);
          const gameId = extractGameIdFromHref(href);

          addGame({
            id: gameId,
            title: linkText
          });
        }
      }
    }

    const extracted = [...games.values()];
    return extracted.length ? extracted : parseHeadlineGames(title, []);
  }

  function collectItemCards() {
    return [...document.querySelectorAll('.marketIndexItem')].filter((card) => {
      const cardData = parseItemCard(card);
      return Boolean(cardData?.url);
    });
  }

  async function fetchItemData(itemUrl) {
    const absoluteUrl = new URL(itemUrl, window.location.origin).toString();
    if (ITEM_DATA_CACHE.has(absoluteUrl)) {
      return ITEM_DATA_CACHE.get(absoluteUrl);
    }

    const fetchPromise = (async () => {
      const response = await fetch(absoluteUrl, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`Не удалось открыть лот (${response.status})`);
      }

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return parseItemDocument(doc, absoluteUrl);
    })();

    ITEM_DATA_CACHE.set(absoluteUrl, fetchPromise);

    try {
      return await fetchPromise;
    } catch (error) {
      ITEM_DATA_CACHE.delete(absoluteUrl);
      throw error;
    }
  }

  function parseCategorySlug(root = document) {
    const breadcrumbLink = [...root.querySelectorAll('.breadcrumb .crumb')].find((link) => /category_id=\d+/.test(link.getAttribute('href') || ''));

    if (breadcrumbLink) {
      const href = breadcrumbLink.getAttribute('href') || '';
      const categoryIdMatch = href.match(/category_id=(\d+)/);
      if (categoryIdMatch) {
        const byId = CATEGORY_BY_ID[Number(categoryIdMatch[1])];
        if (byId) {
          return byId;
        }
      }

      const byLabel = resolveCategoryLabel(cleanText(breadcrumbLink.textContent));
      if (byLabel) {
        return byLabel;
      }
    }

    for (const crumb of [...root.querySelectorAll('.breadcrumb .crumb')]) {
      const byLabel = resolveCategoryLabel(cleanText(crumb.textContent));
      if (byLabel) {
        return byLabel;
      }
    }

    const categoryIcon = root.querySelector('.marketItemViewHeadBlock .categoryIcon, .categoryIcon');
    if (categoryIcon) {
      const iconSlug = [...categoryIcon.classList].find((name) => !['categoryIcon', 'Tooltip', 'buttonWithIcon', 'accountLinkButton', 'fab'].includes(name));
      if (iconSlug) {
        return iconSlug;
      }
    }

    return '';
  }

  function resolveCategoryLabel(label) {
    const normalized = decodeHtmlEntities(cleanText(label)).toLowerCase().replace(/^аккаунты\s+/, '');
    return CATEGORY_LABEL_MAP[normalized] || '';
  }

  // Запросы к Market API и подбор похожих лотов
  async function loadComparableItems(itemData, token) {
    const path = buildCategoryPath(itemData.categorySlug);
    const paramSets = buildApiParamsVariants(itemData);
    const collected = new Map();
    const strictCollected = new Map();
    const debugRequests = [];
    let lastError = null;

    for (const variant of paramSets) {
      const url = `${API_BASE}${path}?${variant.params.toString()}`;
      const response = await gmRequest({
        method: 'GET',
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        }
      });

      const requestDebug = {
        mode: variant.mode,
        url,
        status: response.status
      };

      if (response.status < 200 || response.status >= 300) {
        lastError = new Error(`API вернуло ${response.status}: ${String(response.responseText || '').slice(0, 200)}`);
        requestDebug.error = String(response.responseText || '').slice(0, 500);
        debugRequests.push(requestDebug);
        continue;
      }

      try {
        const data = JSON.parse(response.responseText || '{}');
        const normalized = normalizeApiItems(data);
        requestDebug.resultCount = normalized.length;
        requestDebug.sample = normalized.slice(0, 8).map((item) => ({
          item_id: item.item_id,
          title: item.title,
          price: item.price
        }));
        debugRequests.push(requestDebug);
        mergeCandidates(collected, normalized, itemData);
        if (variant.mode === 'strict') {
          mergeCandidates(strictCollected, normalized, itemData);
        }
        if (collected.size >= MAX_CANDIDATES) {
          break;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (collected.size) {
      const limit = strictCollected.size >= TARGET_COMPARABLES ? TARGET_COMPARABLES : EXTENDED_COMPARABLES;
      const ranked = rankCandidates(itemData, [...collected.values()]);
      const fallbackRanked = rankCandidates(itemData, [...collected.values()], { allowWideSteamFallback: true });
      const comparables = ranked.length ? ranked.slice(0, limit) : fallbackRanked.slice(0, limit);
      return {
        comparables,
        debug: buildComparisonDebug(itemData, {
          path,
          targetCount: limit,
          strictFound: strictCollected.size,
          totalFound: collected.size,
          requests: debugRequests,
          ranked: ranked.length ? ranked : fallbackRanked,
          source: 'api'
        }),
        selectionMode: ranked.length ? 'strict' : 'broad-fallback'
      };
    }

    const fallback = await loadSimilarItemsFallback(itemData.id);
    if (fallback.length) {
      const ranked = rankCandidates(itemData, fallback);
      return {
        comparables: ranked.slice(0, EXTENDED_COMPARABLES),
        debug: buildComparisonDebug(itemData, {
          path,
          targetCount: EXTENDED_COMPARABLES,
          strictFound: 0,
          totalFound: fallback.length,
          requests: debugRequests,
          ranked,
          source: 'similar-items-fallback'
        }),
        selectionMode: 'similar-items-fallback'
      };
    }

    throw lastError || new Error('Не удалось собрать похожие лоты ни через API, ни через similar-items.');
  }

  function buildCategoryPath(categorySlug) {
    if (!categorySlug) {
      throw new Error('Не удалось определить категорию лота.');
    }

    if (isRiotCategory(categorySlug)) {
      return '/riot';
    }
    return categorySlug === 'world-of-tanks' ? '/wot' : `/${categorySlug}`;
  }

  function getStructuredCategoryConfigs() {
    if (getStructuredCategoryConfigs.cache) {
      return getStructuredCategoryConfigs.cache;
    }

    getStructuredCategoryConfigs.cache = [
      {
        key: 'minecraftInfo',
        match: (categorySlug) => categorySlug === 'minecraft',
        parseDom: (root) => extractMinecraftInfo(root),
        parseApi: extractMinecraftInfoFromApiItem,
        buildApiParamsVariants: buildMinecraftApiParamsVariants,
        compareMetrics: getMinecraftComparableMetrics,
        minScore: MINECRAFT_MIN_SCORE,
        wideFallbackScore: 18
      },
      {
        key: 'fortniteInfo',
        match: (categorySlug) => categorySlug === 'fortnite',
        parseDom: (root, title) => extractFortniteInfo(root, title),
        parseApi: extractFortniteInfoFromApiItem,
        buildApiParamsVariants: buildFortniteApiParamsVariants,
        compareMetrics: getFortniteComparableMetrics,
        minScore: FORTNITE_MIN_SCORE,
        wideFallbackScore: 20
      },
      {
        key: 'robloxInfo',
        match: (categorySlug) => categorySlug === 'roblox',
        parseDom: (root, title) => extractRobloxInfo(root, title),
        parseApi: extractRobloxInfoFromApiItem,
        buildApiParamsVariants: buildRobloxApiParamsVariants,
        compareMetrics: getRobloxComparableMetrics,
        minScore: ROBLOX_MIN_SCORE,
        wideFallbackScore: 18
      },
      {
        key: 'riotInfo',
        match: isRiotCategory,
        parseDom: (root, title) => extractRiotInfo(root, title),
        parseApi: extractRiotInfoFromApiItem,
        buildApiParamsVariants: buildRiotApiParamsVariants,
        compareMetrics: getRiotComparableMetrics,
        minScore: RIOT_MIN_SCORE,
        wideFallbackScore: 18
      }
    ];

    return getStructuredCategoryConfigs.cache;
  }

  function getStructuredCategoryConfig(categorySlug) {
    return getStructuredCategoryConfigs().find((config) => config.match(categorySlug)) || null;
  }

  function extractStructuredInfoFromDom(root, categorySlug, title) {
    const config = getStructuredCategoryConfig(categorySlug);
    if (!config) {
      return {};
    }

    return {
      [config.key]: config.parseDom(root, title)
    };
  }

  function extractStructuredInfoFromApiItem(item) {
    return getStructuredCategoryConfigs().reduce((result, config) => {
      result[config.key] = config.parseApi(item);
      return result;
    }, {});
  }

  function serializeStructuredInfo(value) {
    return value ? JSON.stringify(value) : '';
  }

  function buildStructuredInfoDebugPayload(entity) {
    return getStructuredCategoryConfigs().reduce((result, config) => {
      result[config.key] = entity[config.key] || null;
      return result;
    }, {});
  }

  function selectStructuredComparableCandidates(scored, options, config) {
    const exact = scored.filter((candidate) => candidate._tier === 'exact');
    const close = scored.filter((candidate) => candidate._tier === 'close');
    const medium = scored.filter((candidate) => candidate._tier === 'medium');
    const wide = scored.filter((candidate) => candidate._tier === 'wide');

    const prioritized = [...exact, ...close];
    if (prioritized.length >= 4) {
      return prioritized;
    }

    const extended = [...prioritized, ...medium];
    if (extended.length >= 3) {
      return extended;
    }

    if (options.allowWideSteamFallback) {
      return [...extended, ...wide].filter((candidate) => candidate._score >= config.wideFallbackScore);
    }

    return scored.filter((candidate) => candidate._score >= config.minScore);
  }

  function buildApiParamsVariants(itemData) {
    const structuredConfig = getStructuredCategoryConfig(itemData.categorySlug);
    if (structuredConfig?.buildApiParamsVariants) {
      return structuredConfig.buildApiParamsVariants(itemData);
    }

    const queryGames = itemData.primaryGames?.length
      ? itemData.primaryGames
      : itemData.analysisGames;
    const allGameIds = queryGames.map((game) => game.id).filter(Boolean);
    const strictGameIdSets = buildStrictGameIdSets(allGameIds);
    const relaxedGameIds = allGameIds.slice(0, RELAXED_GAME_FILTER_LIMIT);
    const titleTerms = buildTitleTerms(itemData.title);
    const priceFloor = Math.max(1, Math.floor(itemData.price * 0.45));
    const priceCeil = Math.max(priceFloor + 15, Math.ceil(itemData.price * 2.2));
    const variants = [];

    for (const strictGameIds of strictGameIdSets) {
      const strict = new URLSearchParams();
      strict.set('order_by', 'price_to_up');
      strict.set('show', '100');
      strict.set('pmin', String(priceFloor));
      strict.set('pmax', String(priceCeil));
      strictGameIds.forEach((id) => strict.append('game[]', String(id)));
      if (titleTerms.length && strictGameIds.length <= 2) {
        strict.set('title', titleTerms[0]);
      }
      if (itemData.statuses.some((status) => /Steam Desktop Authenticator/i.test(status))) {
        strict.set('mafile', 'yes');
      }
      variants.push({ mode: 'strict', params: strict });
    }

    if (strictGameIdSets.length) {
      const mediumGameIds = strictGameIdSets[Math.min(1, strictGameIdSets.length - 1)];
      const medium = new URLSearchParams();
      medium.set('order_by', 'price_to_up');
      medium.set('show', '100');
      medium.set('pmin', String(priceFloor));
      medium.set('pmax', String(priceCeil));
      mediumGameIds.slice(0, Math.min(5, mediumGameIds.length)).forEach((id) => medium.append('game[]', String(id)));
      if (titleTerms.length > 1) {
        medium.set('title', titleTerms[1]);
      }
      variants.push({ mode: 'strict', params: medium });
    }

    for (const singleGameId of relaxedGameIds) {
      const single = new URLSearchParams();
      single.set('order_by', 'price_to_up');
      single.set('show', '100');
      single.set('pmin', String(Math.max(1, Math.floor(itemData.price * 0.35))));
      single.set('pmax', String(Math.ceil(itemData.price * 3)));
      single.append('game[]', String(singleGameId));
      variants.push({ mode: 'relaxed', params: single });
    }

    if (titleTerms.length) {
      const titleOnly = new URLSearchParams();
      titleOnly.set('order_by', 'price_to_up');
      titleOnly.set('show', '100');
      titleOnly.set('pmin', String(Math.max(1, Math.floor(itemData.price * 0.35))));
      titleOnly.set('pmax', String(Math.ceil(itemData.price * 3.5)));
      titleOnly.set('title', titleTerms.slice(0, 2).join(' '));
      variants.push({ mode: 'relaxed', params: titleOnly });
    }

    const wide = new URLSearchParams();
    wide.set('order_by', 'price_to_up');
    wide.set('show', '100');
    wide.set('pmin', String(Math.max(1, Math.floor(itemData.price * 0.25))));
    wide.set('pmax', String(Math.ceil(itemData.price * 4)));
    variants.push({ mode: 'relaxed', params: wide });

    return variants;
  }

  function buildFortniteApiParamsVariants(itemData) {
    const info = itemData.fortniteInfo || {};
    const priceFloor = Math.max(1, Math.floor(itemData.price * 0.35));
    const priceCeil = Math.max(priceFloor + 25, Math.ceil(itemData.price * 2.8));
    const widePriceFloor = Math.max(1, Math.floor(itemData.price * 0.2));
    const widePriceCeil = Math.max(widePriceFloor + 50, Math.ceil(itemData.price * 4));
    const headlineSkins = (info.headlineSkins?.length ? info.headlineSkins : info.featuredSkins || []).slice(0, 6);
    const featuredPickaxes = (info.featuredPickaxes || []).slice(0, 2);
    const featuredGliders = (info.featuredGliders || []).slice(0, 2);
    const titleTerms = buildTitleTerms(itemData.title);
    const variants = [];

    const applyCommon = (params, options = {}) => {
      params.set('order_by', 'price_to_up');
      params.set('show', '100');
      params.set('pmin', String(options.priceFloor ?? priceFloor));
      params.set('pmax', String(options.priceCeil ?? priceCeil));

      if (info.platform) {
        params.append('platform[]', info.platform);
      }

      if (info.changeEmail === true) {
        params.set('change_email', 'yes');
      } else if (info.changeEmail === false) {
        params.set('change_email', 'no');
      }

      if (info.battlePass === true) {
        params.set('battle_pass', 'yes');
      } else if (info.battlePass === false) {
        params.set('battle_pass', 'no');
      }

      if (info.xboxLinkable === true) {
        params.set('xbox_linkable', 'yes');
      }

      if (info.psnLinkable === true) {
        params.set('psn_linkable', 'yes');
      }

      if (info.rlPurchases === true) {
        params.set('rl_purchases', 'yes');
      } else if (info.rlPurchases === false) {
        params.set('rl_purchases', 'no');
      }
    };

    const applyRange = (params, minKey, maxKey, value, tolerance, minBound = 0) => {
      if (!Number.isFinite(value)) {
        return;
      }

      const min = Math.max(minBound, Math.floor(value - tolerance));
      const max = Math.max(min + 1, Math.ceil(value + tolerance));
      params.set(minKey, String(min));
      params.set(maxKey, String(max));
    };

    const strict = new URLSearchParams();
    applyCommon(strict);
    applyRange(strict, 'smin', 'smax', info.skinCount, Math.max(10, (info.skinCount || 0) * 0.2));
    applyRange(strict, 'vbmin', 'vbmax', info.balance, Math.max(150, (info.balance || 0) * 0.4));
    applyRange(strict, 'lmin', 'lmax', info.level, Math.max(25, (info.level || 0) * 0.18));
    applyRange(strict, 'pickaxe_min', 'pickaxe_max', info.pickaxeCount, Math.max(8, (info.pickaxeCount || 0) * 0.2));
    applyRange(strict, 'dance_min', 'dance_max', info.danceCount, Math.max(8, (info.danceCount || 0) * 0.2));
    applyRange(strict, 'glider_min', 'glider_max', info.gliderCount, Math.max(6, (info.gliderCount || 0) * 0.18));
    applyRange(strict, 'wins_min', 'wins_max', info.lifetimeWins, Math.max(20, (info.lifetimeWins || 0) * 0.35));
    applyRange(strict, 'friends_min', 'friends_max', info.friendsCount, Math.max(6, (info.friendsCount || 0) * 0.5));
    applyRange(strict, 'refund_credits_min', 'refund_credits_max', info.refundCredits, 1);
    applyRange(strict, 'book_level_min', 'book_level_max', info.bookLevel, Math.max(5, (info.bookLevel || 0) * 0.35));
    headlineSkins.forEach((skin) => strict.append('skin[]', skin.id));
    featuredPickaxes.forEach((item) => strict.append('pickaxe[]', item.id));
    featuredGliders.forEach((item) => strict.append('glider[]', item.id));
    variants.push({ mode: 'strict', params: strict });

    const medium = new URLSearchParams();
    applyCommon(medium, { priceFloor: Math.max(1, Math.floor(itemData.price * 0.25)), priceCeil: Math.ceil(itemData.price * 3.2) });
    applyRange(medium, 'smin', 'smax', info.skinCount, Math.max(20, (info.skinCount || 0) * 0.35));
    applyRange(medium, 'vbmin', 'vbmax', info.balance, Math.max(300, (info.balance || 0) * 0.8));
    applyRange(medium, 'lmin', 'lmax', info.level, Math.max(50, (info.level || 0) * 0.35));
    applyRange(medium, 'pickaxe_min', 'pickaxe_max', info.pickaxeCount, Math.max(14, (info.pickaxeCount || 0) * 0.35));
    applyRange(medium, 'dance_min', 'dance_max', info.danceCount, Math.max(14, (info.danceCount || 0) * 0.35));
    applyRange(medium, 'glider_min', 'glider_max', info.gliderCount, Math.max(10, (info.gliderCount || 0) * 0.3));
    applyRange(medium, 'wins_min', 'wins_max', info.lifetimeWins, Math.max(40, (info.lifetimeWins || 0) * 0.6));
    headlineSkins.slice(0, 3).forEach((skin) => medium.append('skin[]', skin.id));
    variants.push({ mode: 'strict', params: medium });

    const relaxed = new URLSearchParams();
    applyCommon(relaxed, { priceFloor: widePriceFloor, priceCeil: widePriceCeil });
    applyRange(relaxed, 'smin', 'smax', info.skinCount, Math.max(35, (info.skinCount || 0) * 0.5));
    applyRange(relaxed, 'lmin', 'lmax', info.level, Math.max(80, (info.level || 0) * 0.5));
    applyRange(relaxed, 'pickaxe_min', 'pickaxe_max', info.pickaxeCount, Math.max(20, (info.pickaxeCount || 0) * 0.45));
    applyRange(relaxed, 'dance_min', 'dance_max', info.danceCount, Math.max(20, (info.danceCount || 0) * 0.45));
    applyRange(relaxed, 'glider_min', 'glider_max', info.gliderCount, Math.max(16, (info.gliderCount || 0) * 0.4));
    variants.push({ mode: 'relaxed', params: relaxed });

    if (titleTerms.length) {
      const titled = new URLSearchParams();
      applyCommon(titled, { priceFloor: widePriceFloor, priceCeil: widePriceCeil });
      titled.set('title', titleTerms.slice(0, 2).join(' '));
      variants.push({ mode: 'relaxed', params: titled });
    }

    const wide = new URLSearchParams();
    applyCommon(wide, { priceFloor: widePriceFloor, priceCeil: widePriceCeil });
    variants.push({ mode: 'relaxed', params: wide });

    return variants;
  }

  function buildMinecraftApiParamsVariants(itemData) {
    const info = itemData.minecraftInfo || {};
    const priceFloor = Math.max(1, Math.floor(itemData.price * 0.4));
    const priceCeil = Math.max(priceFloor + 25, Math.ceil(itemData.price * 2.6));
    const widePriceFloor = Math.max(1, Math.floor(itemData.price * 0.25));
    const widePriceCeil = Math.max(widePriceFloor + 40, Math.ceil(itemData.price * 4));
    const titleTerms = buildTitleTerms(itemData.title);
    const variants = [];

    const applyCommon = (params, options = {}) => {
      params.set('order_by', 'price_to_up');
      params.set('show', '100');
      params.set('pmin', String(options.priceFloor ?? priceFloor));
      params.set('pmax', String(options.priceCeil ?? priceCeil));

      if (info.java === true) {
        params.set('java', 'yes');
      }
      if (info.bedrock === true) {
        params.set('bedrock', 'yes');
      }
      if (info.dungeons === true) {
        params.set('dungeons', 'yes');
      }
      if (info.legends === true) {
        params.set('legends', 'yes');
      }
      if (info.canChangeNickname === true) {
        params.set('change_nickname', 'yes');
      }
      if (info.hypixelApi === true) {
        params.set('hypixel_skyblock_api_enabled', 'yes');
      }
      if (info.hypixelBan === 'absent') {
        params.set('hypixel_ban', 'no');
      }
    };

    const applyRange = (params, minKey, maxKey, value, tolerance, minBound = 0) => {
      if (!Number.isFinite(value)) {
        return;
      }

      const min = Math.max(minBound, Math.floor(value - tolerance));
      const max = Math.max(min + 1, Math.ceil(value + tolerance));
      params.set(minKey, String(min));
      params.set(maxKey, String(max));
    };

    const strict = new URLSearchParams();
    applyCommon(strict);
    applyRange(strict, 'minecoins_min', 'minecoins_max', info.minecoins, Math.max(50, (info.minecoins || 0) * 0.75));
    applyRange(strict, 'capes_min', 'capes_max', info.capesCount, Math.max(1, Math.ceil((info.capesCount || 0) * 0.5)));
    applyRange(strict, 'level_hypixel_min', 'level_hypixel_max', info.hypixelLevel, Math.max(4, (info.hypixelLevel || 0) * 0.5));
    applyRange(strict, 'achievement_hypixel_min', 'achievement_hypixel_max', info.hypixelAchievement, Math.max(250, (info.hypixelAchievement || 0) * 0.6));
    applyRange(strict, 'level_hypixel_skyblock_min', 'level_hypixel_skyblock_max', info.hypixelSkyblockLevel, Math.max(3, (info.hypixelSkyblockLevel || 0) * 0.6));
    applyRange(strict, 'net_worth_hypixel_skyblock_min', 'net_worth_hypixel_skyblock_max', info.hypixelSkyblockNetWorth, Math.max(15000, (info.hypixelSkyblockNetWorth || 0) * 0.65));
    variants.push({ mode: 'strict', params: strict });

    const medium = new URLSearchParams();
    applyCommon(medium, { priceFloor: Math.max(1, Math.floor(itemData.price * 0.3)), priceCeil: Math.ceil(itemData.price * 3.2) });
    applyRange(medium, 'minecoins_min', 'minecoins_max', info.minecoins, Math.max(100, (info.minecoins || 0) * 1.25));
    applyRange(medium, 'capes_min', 'capes_max', info.capesCount, Math.max(1, Math.ceil((info.capesCount || 0) * 0.9)));
    applyRange(medium, 'level_hypixel_min', 'level_hypixel_max', info.hypixelLevel, Math.max(8, info.hypixelLevel || 0));
    applyRange(medium, 'achievement_hypixel_min', 'achievement_hypixel_max', info.hypixelAchievement, Math.max(500, info.hypixelAchievement || 0));
    applyRange(medium, 'level_hypixel_skyblock_min', 'level_hypixel_skyblock_max', info.hypixelSkyblockLevel, Math.max(5, info.hypixelSkyblockLevel || 0));
    applyRange(medium, 'net_worth_hypixel_skyblock_min', 'net_worth_hypixel_skyblock_max', info.hypixelSkyblockNetWorth, Math.max(25000, info.hypixelSkyblockNetWorth || 0));
    variants.push({ mode: 'strict', params: medium });

    const relaxed = new URLSearchParams();
    applyCommon(relaxed, { priceFloor: Math.max(1, Math.floor(itemData.price * 0.25)), priceCeil: Math.ceil(itemData.price * 3.6) });
    applyRange(relaxed, 'capes_min', 'capes_max', info.capesCount, Math.max(2, Math.ceil((info.capesCount || 0) * 1.5)));
    applyRange(relaxed, 'level_hypixel_min', 'level_hypixel_max', info.hypixelLevel, Math.max(12, (info.hypixelLevel || 0) * 1.5));
    applyRange(relaxed, 'level_hypixel_skyblock_min', 'level_hypixel_skyblock_max', info.hypixelSkyblockLevel, Math.max(8, (info.hypixelSkyblockLevel || 0) * 1.5));
    variants.push({ mode: 'relaxed', params: relaxed });

    if (titleTerms.length) {
      const titled = new URLSearchParams();
      applyCommon(titled, { priceFloor: widePriceFloor, priceCeil: widePriceCeil });
      titled.set('title', titleTerms.slice(0, 2).join(' '));
      variants.push({ mode: 'relaxed', params: titled });
    }

    const wide = new URLSearchParams();
    applyCommon(wide, { priceFloor: widePriceFloor, priceCeil: widePriceCeil });
    variants.push({ mode: 'relaxed', params: wide });

    return variants;
  }

  function buildRobloxApiParamsVariants(itemData) {
    const info = itemData.robloxInfo || {};
    const priceFloor = Math.max(1, Math.floor(itemData.price * 0.35));
    const priceCeil = Math.max(priceFloor + 20, Math.ceil(itemData.price * 2.8));
    const widePriceFloor = Math.max(1, Math.floor(itemData.price * 0.2));
    const widePriceCeil = Math.max(widePriceFloor + 35, Math.ceil(itemData.price * 4.2));
    const titleTerms = buildTitleTerms(itemData.title);
    const variants = [];

    const applyCommon = (params, options = {}) => {
      params.set('order_by', 'price_to_up');
      params.set('show', '100');
      params.set('pmin', String(options.priceFloor ?? priceFloor));
      params.set('pmax', String(options.priceCeil ?? priceCeil));

      if (info.ageGroup) {
        params.append('age_group[]', info.ageGroup);
      }

      applyNomatterFilter(params, 'voice', info.voice);
      applyNomatterFilter(params, 'verified', info.verified);
      applyNomatterFilter(params, 'age_verified', info.ageVerified);
      applyNomatterFilter(params, 'email', info.emailVerified);
      applyNomatterFilter(params, 'autorenewal', info.subscriptionAutoRenew);

      if (looksLikeCountryCode(info.country)) {
        params.append('country[]', info.country);
      }
    };

    const applyRange = (params, minKey, maxKey, value, tolerance, minBound = 0) => {
      if (!Number.isFinite(value)) {
        return;
      }

      const min = Math.max(minBound, Math.floor(value - tolerance));
      const max = Math.max(min + 1, Math.ceil(value + tolerance));
      params.set(minKey, String(min));
      params.set(maxKey, String(max));
    };

    const strict = new URLSearchParams();
    applyCommon(strict);
    applyRange(strict, 'robux_min', 'robux_max', info.robux, Math.max(30, (info.robux || 0) * 0.6));
    applyRange(strict, 'friends_min', 'friends_max', info.friends, Math.max(8, (info.friends || 0) * 0.4));
    applyRange(strict, 'followers_min', 'followers_max', info.followers, Math.max(4, (info.followers || 0) * 0.5));
    applyRange(strict, 'inv_min', 'inv_max', info.inventoryPrice, Math.max(150, (info.inventoryPrice || 0) * 0.3));
    applyRange(strict, 'limited_price_min', 'limited_price_max', info.limitedPrice, Math.max(80, (info.limitedPrice || 0) * 0.35));
    applyRange(strict, 'ugc_limited_price_min', 'ugc_limited_price_max', info.ugcLimitedPrice, Math.max(80, (info.ugcLimitedPrice || 0) * 0.35));
    applyRange(strict, 'gamepass_min', 'gamepass_max', info.gamepassTotal, Math.max(180, (info.gamepassTotal || 0) * 0.3));
    applyRange(strict, 'credit_balance_min', 'credit_balance_max', info.creditBalance, Math.max(40, (info.creditBalance || 0) * 0.4));
    applyRange(strict, 'offsale_min', 'offsale_max', info.offsaleCount, Math.max(2, Math.ceil((info.offsaleCount || 0) * 0.3)));
    variants.push({ mode: 'strict', params: strict });

    const medium = new URLSearchParams();
    applyCommon(medium, { priceFloor: Math.max(1, Math.floor(itemData.price * 0.25)), priceCeil: Math.ceil(itemData.price * 3.3) });
    applyRange(medium, 'robux_min', 'robux_max', info.robux, Math.max(80, (info.robux || 0) * 1));
    applyRange(medium, 'inv_min', 'inv_max', info.inventoryPrice, Math.max(300, (info.inventoryPrice || 0) * 0.5));
    applyRange(medium, 'limited_price_min', 'limited_price_max', info.limitedPrice, Math.max(160, (info.limitedPrice || 0) * 0.6));
    applyRange(medium, 'ugc_limited_price_min', 'ugc_limited_price_max', info.ugcLimitedPrice, Math.max(160, (info.ugcLimitedPrice || 0) * 0.6));
    applyRange(medium, 'gamepass_min', 'gamepass_max', info.gamepassTotal, Math.max(300, (info.gamepassTotal || 0) * 0.55));
    applyRange(medium, 'offsale_min', 'offsale_max', info.offsaleCount, Math.max(4, Math.ceil((info.offsaleCount || 0) * 0.5)));
    variants.push({ mode: 'strict', params: medium });

    const relaxed = new URLSearchParams();
    applyCommon(relaxed, { priceFloor: widePriceFloor, priceCeil: widePriceCeil });
    applyRange(relaxed, 'inv_min', 'inv_max', info.inventoryPrice, Math.max(450, (info.inventoryPrice || 0) * 0.8));
    applyRange(relaxed, 'gamepass_min', 'gamepass_max', info.gamepassTotal, Math.max(450, (info.gamepassTotal || 0) * 0.8));
    applyRange(relaxed, 'offsale_min', 'offsale_max', info.offsaleCount, Math.max(6, Math.ceil((info.offsaleCount || 0) * 0.8)));
    variants.push({ mode: 'relaxed', params: relaxed });

    if (titleTerms.length) {
      const titled = new URLSearchParams();
      applyCommon(titled, { priceFloor: widePriceFloor, priceCeil: widePriceCeil });
      titled.set('title', titleTerms.slice(0, 2).join(' '));
      variants.push({ mode: 'relaxed', params: titled });
    }

    const wide = new URLSearchParams();
    applyCommon(wide, { priceFloor: widePriceFloor, priceCeil: widePriceCeil });
    variants.push({ mode: 'relaxed', params: wide });

    return variants;
  }

  function buildRiotApiParamsVariants(itemData) {
    const info = itemData.riotInfo || {};
    const priceFloor = Math.max(1, Math.floor(itemData.price * 0.35));
    const priceCeil = Math.max(priceFloor + 25, Math.ceil(itemData.price * 2.8));
    const widePriceFloor = Math.max(1, Math.floor(itemData.price * 0.2));
    const widePriceCeil = Math.max(widePriceFloor + 50, Math.ceil(itemData.price * 4));
    const titleTerms = buildTitleTerms(itemData.title);
    const variants = [];

    const applyCommon = (params, options = {}) => {
      params.set('order_by', 'price_to_up');
      params.set('show', '100');
      params.set('pmin', String(options.priceFloor ?? priceFloor));
      params.set('pmax', String(options.priceCeil ?? priceCeil));
      applyNomatterFilter(params, 'email', info.emailLinked);
      applyNomatterFilter(params, 'tel', info.phoneVerified);

      if (info.mode === 'valorant') {
        if (looksLikeRiotRegionCode(info.valorant.region)) {
          params.append('valorant_region[]', info.valorant.region);
        }
      }

      if (info.mode === 'lol') {
        if (looksLikeRiotRegionCode(info.lol.region)) {
          params.append('lol_region[]', info.lol.region);
        }
        if (info.lol.rank && !/^unranked|без ранга$/i.test(info.lol.rank)) {
          params.append('lol_rank[]', info.lol.rank);
        }
      }
    };

    const applyRange = (params, minKey, maxKey, value, tolerance, minBound = 0) => {
      if (!Number.isFinite(value)) {
        return;
      }

      const min = Math.max(minBound, Math.floor(value - tolerance));
      const max = Math.max(min + 1, Math.ceil(value + tolerance));
      params.set(minKey, String(min));
      params.set(maxKey, String(max));
    };

    if (info.mode === 'valorant') {
      const strict = new URLSearchParams();
      applyCommon(strict);
      applyRange(strict, 'inv_min', 'inv_max', info.valorant.inventoryValue, Math.max(400, (info.valorant.inventoryValue || 0) * 0.22));
      applyRange(strict, 'vp_min', 'vp_max', info.valorant.vp, Math.max(100, (info.valorant.vp || 0) * 0.45));
      applyRange(strict, 'rp_min', 'rp_max', info.valorant.rp, Math.max(80, (info.valorant.rp || 0) * 0.45));
      applyRange(strict, 'fa_min', 'fa_max', info.valorant.freeAgents, Math.max(1, (info.valorant.freeAgents || 0) * 0.5));
      applyRange(strict, 'lvl_min', 'lvl_max', info.valorant.level, Math.max(20, (info.valorant.level || 0) * 0.18));
      applyRange(strict, 'knife_min', 'knife_max', info.valorant.knifeCount, Math.max(1, (info.valorant.knifeCount || 0) * 0.45));
      applyRange(strict, 'skin_min', 'skin_max', info.valorant.skinCount, Math.max(2, (info.valorant.skinCount || 0) * 0.3));
      if (Number.isFinite(info.valorant.currentRankValue) && info.valorant.currentRankValue > 1) {
        strict.set('rmin', String(Math.max(0, info.valorant.currentRankValue - 1)));
        strict.set('rmax', String(info.valorant.currentRankValue + 1));
      } else if (info.valorant.currentRankText && /ranked ready/i.test(info.valorant.currentRankText)) {
        strict.set('rr', 'yes');
      }
      variants.push({ mode: 'strict', params: strict });

      const medium = new URLSearchParams();
      applyCommon(medium, { priceFloor: Math.max(1, Math.floor(itemData.price * 0.25)), priceCeil: Math.ceil(itemData.price * 3.2) });
      applyRange(medium, 'inv_min', 'inv_max', info.valorant.inventoryValue, Math.max(900, (info.valorant.inventoryValue || 0) * 0.45));
      applyRange(medium, 'lvl_min', 'lvl_max', info.valorant.level, Math.max(40, (info.valorant.level || 0) * 0.35));
      applyRange(medium, 'knife_min', 'knife_max', info.valorant.knifeCount, Math.max(1, (info.valorant.knifeCount || 0) * 0.8));
      if (Number.isFinite(info.valorant.lastRankValue) && info.valorant.lastRankValue > 1) {
        medium.set('lrmin', String(Math.max(0, info.valorant.lastRankValue - 2)));
        medium.set('lrmax', String(info.valorant.lastRankValue + 2));
      }
      variants.push({ mode: 'strict', params: medium });

      const soft = new URLSearchParams();
      soft.set('order_by', 'price_to_up');
      soft.set('show', '100');
      soft.set('pmin', String(widePriceFloor));
      soft.set('pmax', String(widePriceCeil));
      applyRange(soft, 'inv_min', 'inv_max', info.valorant.inventoryValue, Math.max(1800, (info.valorant.inventoryValue || 0) * 0.75));
      applyRange(soft, 'knife_min', 'knife_max', info.valorant.knifeCount, Math.max(2, (info.valorant.knifeCount || 0) * 1.5));
      variants.push({ mode: 'relaxed', params: soft });
    } else if (info.mode === 'lol') {
      const strict = new URLSearchParams();
      applyCommon(strict);
      applyRange(strict, 'champion_min', 'champion_max', info.lol.championCount, Math.max(6, (info.lol.championCount || 0) * 0.18));
      applyRange(strict, 'skin_min', 'skin_max', info.lol.skinCount, Math.max(2, (info.lol.skinCount || 0) * 0.25));
      applyRange(strict, 'lvl_min', 'lvl_max', info.lol.level, Math.max(8, (info.lol.level || 0) * 0.2));
      applyRange(strict, 'be_min', 'be_max', info.lol.blueEssence, Math.max(250, (info.lol.blueEssence || 0) * 0.45));
      applyRange(strict, 'oe_min', 'oe_max', info.lol.orangeEssence, Math.max(120, (info.lol.orangeEssence || 0) * 0.45));
      applyRange(strict, 'me_min', 'me_max', info.lol.mythicEssence, Math.max(10, (info.lol.mythicEssence || 0) * 0.5));
      applyRange(strict, 'rp_min', 'rp_max', info.lol.riotPoints, Math.max(120, (info.lol.riotPoints || 0) * 0.45));
      variants.push({ mode: 'strict', params: strict });

      const medium = new URLSearchParams();
      applyCommon(medium, { priceFloor: Math.max(1, Math.floor(itemData.price * 0.25)), priceCeil: Math.ceil(itemData.price * 3.2) });
      applyRange(medium, 'champion_min', 'champion_max', info.lol.championCount, Math.max(12, (info.lol.championCount || 0) * 0.35));
      applyRange(medium, 'skin_min', 'skin_max', info.lol.skinCount, Math.max(4, (info.lol.skinCount || 0) * 0.45));
      applyRange(medium, 'lvl_min', 'lvl_max', info.lol.level, Math.max(15, (info.lol.level || 0) * 0.35));
      variants.push({ mode: 'strict', params: medium });

      const soft = new URLSearchParams();
      soft.set('order_by', 'price_to_up');
      soft.set('show', '100');
      soft.set('pmin', String(widePriceFloor));
      soft.set('pmax', String(widePriceCeil));
      applyRange(soft, 'champion_min', 'champion_max', info.lol.championCount, Math.max(24, (info.lol.championCount || 0) * 0.7));
      applyRange(soft, 'skin_min', 'skin_max', info.lol.skinCount, Math.max(8, (info.lol.skinCount || 0) * 0.8));
      variants.push({ mode: 'relaxed', params: soft });
    }

    if (titleTerms.length) {
      const titled = new URLSearchParams();
      applyCommon(titled, { priceFloor: widePriceFloor, priceCeil: widePriceCeil });
      titled.set('title', titleTerms.slice(0, 2).join(' '));
      variants.push({ mode: 'relaxed', params: titled });
    }

    const wide = new URLSearchParams();
    applyCommon(wide, { priceFloor: widePriceFloor, priceCeil: widePriceCeil });
    variants.push({ mode: 'relaxed', params: wide });

    return variants;
  }

  function buildStrictGameIdSets(allGameIds) {
    const capped = allGameIds.slice(0, STRICT_GAME_FILTER_LIMIT);
    if (capped.length <= MIN_STRICT_GAME_FILTER_LIMIT) {
      return capped.length ? [capped] : [];
    }

    const step = capped.length > 10 ? 2 : 1;
    const variants = [];
    const seen = new Set();

    const pushVariant = (ids) => {
      if (!ids.length || ids.length < MIN_STRICT_GAME_FILTER_LIMIT) {
        return;
      }

      const key = ids.join(',');
      if (!seen.has(key)) {
        seen.add(key);
        variants.push(ids);
      }
    };

    pushVariant(capped);

    if (capped.length <= 6) {
      const targetSize = Math.max(capped.length - step, MIN_STRICT_GAME_FILTER_LIMIT);
      for (let index = 0; index < capped.length; index += 1) {
        pushVariant(capped.filter((_, currentIndex) => currentIndex !== index));
      }

      if (targetSize > MIN_STRICT_GAME_FILTER_LIMIT) {
        for (let size = targetSize - step; size >= MIN_STRICT_GAME_FILTER_LIMIT; size -= step) {
          pushVariant(capped.slice(0, size));
        }
      }
    } else {
      for (let size = capped.length - step; size >= MIN_STRICT_GAME_FILTER_LIMIT; size -= step) {
        pushVariant(capped.slice(0, size));
      }
    }

    return variants;
  }

  function normalizeApiItems(payload) {
    const roots = [
      payload?.items,
      payload?.accounts,
      payload?.data?.items,
      payload?.data?.accounts,
      payload?.results,
      payload?.data,
      Array.isArray(payload) ? payload : null
    ];

    const source = roots.find((value) => Array.isArray(value));
    if (!source) {
      throw new Error('Не удалось распознать структуру ответа Market API.');
    }

    return source.map((item) => ({
      item_id: item.item_id ?? item.id ?? item.account_id,
      price: Number(item.price ?? item.price_rub ?? item.amount ?? 0),
      title: cleanText(item.title ?? item.name ?? item.description ?? ''),
      url: buildComparableUrl(item),
      seller: cleanText(item.seller?.username ?? item.user?.username ?? item.username ?? ''),
      ...extractStructuredInfoFromApiItem(item)
    })).filter((item) => item.item_id && item.price > 0);
  }

  async function loadSimilarItemsFallback(itemId) {
    try {
      const response = await fetch(`${window.location.origin}/${itemId}/similar-items`, { credentials: 'include' });
      if (!response.ok) {
        return [];
      }

      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const cards = [...doc.querySelectorAll('.marketIndexItem, .item')];

      return cards.map((card) => {
        const link = card.querySelector('a[href]');
        const priceNode = card.querySelector('.Value[data-value], .priceBadgeTransparent, .price');
        const href = link?.getAttribute('href') || '';
        const idMatch = href.match(/(\d+)/);
        const rawPrice = priceNode?.getAttribute?.('data-value') || cleanText(priceNode?.textContent).replace(/[^\d.,]/g, '').replace(',', '.');
        return {
          item_id: idMatch ? idMatch[1] : null,
          price: Number(rawPrice || 0),
          title: cleanText(link?.textContent),
          url: href ? new URL(href, window.location.origin).toString() : window.location.origin,
          seller: ''
        };
      }).filter((item) => item.item_id && Number.isFinite(item.price) && item.price > 0);
    } catch (error) {
      console.error('[LZT Market Copilot] similar-items fallback failed', error);
      return [];
    }
  }

  function buildComparableUrl(item) {
    const id = item.item_id ?? item.id ?? item.account_id;
    return id ? `${window.location.origin}/${id}/` : window.location.origin;
  }

  function buildAnalysisCacheKey(itemData) {
    const gamesKey = itemData.analysisGames.map((game) => game.id || game.title).join(',');
    const primaryGamesKey = (itemData.primaryGames || []).map((game) => game.id || game.title).join(',');
    const statusesKey = itemData.statuses.join('|');
    const structuredKeys = getStructuredCategoryConfigs().map((config) => serializeStructuredInfo(itemData[config.key]));
    return [
      itemData.id || itemData.url,
      itemData.categorySlug,
      itemData.price,
      gamesKey,
      primaryGamesKey,
      statusesKey,
      itemData.title,
      ...structuredKeys
    ].join('::');
  }

  function invalidateAnalysisCache(itemData) {
    const cacheKey = buildAnalysisCacheKey(itemData);
    ANALYSIS_CACHE.delete(cacheKey);
    ANALYSIS_META_CACHE.delete(cacheKey);
    if (itemData?.url) {
      ITEM_DATA_CACHE.delete(new URL(itemData.url, window.location.origin).toString());
    }
    return cacheKey;
  }

  function mergeCandidates(target, candidates, itemData) {
    for (const candidate of candidates) {
      if (!candidate.item_id || String(candidate.item_id) === String(itemData.id)) {
        continue;
      }

      const key = String(candidate.item_id);
      const existing = target.get(key);
      if (!existing) {
        target.set(key, candidate);
        continue;
      }

      target.set(key, {
        ...existing,
        ...candidate,
        title: candidate.title || existing.title,
        seller: candidate.seller || existing.seller
      });
    }
  }

  function rankCandidates(itemData, candidates, options = {}) {
    const scored = candidates
      .map((candidate) => {
        const metrics = getComparableMetrics(itemData, candidate);
        return {
          ...candidate,
          _score: metrics.score,
          _matchedGames: metrics.matchedGames,
          _gameCoverage: metrics.gameCoverage,
          _tier: metrics.tier,
          _tierRank: metrics.tierRank
        };
      })
      .sort((left, right) => {
        if (left._tierRank !== right._tierRank) {
          return left._tierRank - right._tierRank;
        }

        if (right._score !== left._score) {
          return right._score - left._score;
        }
        return Math.abs(left.price - itemData.price) - Math.abs(right.price - itemData.price);
      });

    return selectComparableCandidates(itemData, scored, options);
  }

  function getComparableMetrics(itemData, candidate) {
    const structuredConfig = getStructuredCategoryConfig(itemData.categorySlug);
    const sourceStructuredInfo = structuredConfig ? itemData[structuredConfig.key] : null;
    const candidateStructuredInfo = structuredConfig ? candidate[structuredConfig.key] : null;
    if (structuredConfig?.compareMetrics && sourceStructuredInfo && candidateStructuredInfo) {
      return structuredConfig.compareMetrics(itemData, candidate);
    }

    const sourceGames = getScoredGameTitles(itemData);
    const candidateTitle = (candidate.title || '').toLowerCase();
    const candidateTokens = new Set(tokenize(candidate.title));
    const sourceTokens = tokenize(itemData.title);

    let score = 0;
    let matchedGames = 0;

    for (const gameTitle of sourceGames) {
      if (candidateTitle.includes(gameTitle)) {
        matchedGames += 1;
      }
    }

    if (sourceGames.length) {
      score += (matchedGames / sourceGames.length) * 70;
    }

    let tokenMatches = 0;
    for (const token of sourceTokens) {
      if (candidateTokens.has(token)) {
        tokenMatches += 1;
      }
    }

    if (sourceTokens.length) {
      score += Math.min(20, (tokenMatches / sourceTokens.length) * 20);
    }

    const priceDelta = Math.abs(candidate.price - itemData.price) / Math.max(itemData.price, 1);
    score += Math.max(0, 15 - priceDelta * 20);

    if (candidateTitle.includes('steam guard') && itemData.statuses.some((status) => /steam guard/i.test(status))) {
      score += 4;
    }

    if (candidateTitle.includes('sda') && itemData.statuses.some((status) => /steam desktop authenticator/i.test(status))) {
      score += 6;
    }

    const gameCoverage = sourceGames.length ? matchedGames / sourceGames.length : 0;
    const tier = resolveComparableTier(itemData, matchedGames, sourceGames.length);

    return {
      score: Math.round(score * 100) / 100,
      matchedGames,
      gameCoverage,
      tier,
      tierRank: getComparableTierRank(tier)
    };
  }

  function selectComparableCandidates(itemData, scored, options = {}) {
    const structuredConfig = getStructuredCategoryConfig(itemData.categorySlug);
    if (structuredConfig) {
      return selectStructuredComparableCandidates(scored, options, structuredConfig);
    }

    if (itemData.categorySlug !== 'steam') {
      return scored.filter((candidate) => candidate._score >= 10);
    }

    const sourceGamesCount = getScoredGameTitles(itemData).length;
    if (sourceGamesCount < 3) {
      return scored.filter((candidate) => candidate._matchedGames >= 1 || candidate._score >= 20);
    }

    const exact = scored.filter((candidate) => candidate._tier === 'exact');
    const close = scored.filter((candidate) => candidate._tier === 'close');
    const medium = scored.filter((candidate) => candidate._tier === 'medium');
    const wide = scored.filter((candidate) => candidate._tier === 'wide');

    if (exact.length >= 4) {
      return exact;
    }

    if (sourceGamesCount >= 4) {
      const prioritized = [...exact, ...close];
      if (prioritized.length >= 4) {
        return prioritized;
      }

      const extended = [...prioritized, ...medium];
      if (extended.length) {
        return extended;
      }

      if (options.allowWideSteamFallback) {
        return [...exact, ...close, ...medium, ...wide];
      }

      return [];
    }

    const fallback = [...exact, ...close, ...medium];
    if (fallback.length) {
      return fallback;
    }

    if (options.allowWideSteamFallback) {
      return wide.length ? wide : scored.filter((candidate) => candidate._matchedGames >= 1 || candidate._score >= 18);
    }

    return [];
  }

  function getScoredGameTitles(itemData) {
    const sourceGames = itemData.primaryGames?.length
      ? itemData.primaryGames
      : itemData.analysisGames;

    return sourceGames
      .slice(0, STEAM_SCORE_GAME_LIMIT)
      .map((game) => game.title.toLowerCase());
  }

  function resolveComparableTier(itemData, matchedGames, sourceGamesCount) {
    if (itemData.categorySlug !== 'steam') {
      return matchedGames >= 1 ? 'close' : 'wide';
    }

    if (!sourceGamesCount) {
      return 'wide';
    }

    const exactThreshold = Math.max(sourceGamesCount - 1, 1);
    const closeThreshold = Math.max(sourceGamesCount - 2, 1);
    const mediumThreshold = Math.max(Math.ceil(sourceGamesCount / 2), 2);

    if (matchedGames >= exactThreshold) {
      return 'exact';
    }

    if (matchedGames >= closeThreshold) {
      return 'close';
    }

    if (matchedGames >= mediumThreshold) {
      return 'medium';
    }

    return matchedGames >= 1 ? 'wide' : 'none';
  }

  function getComparableTierRank(tier) {
    switch (tier) {
      case 'exact':
        return 0;
      case 'close':
        return 1;
      case 'medium':
        return 2;
      case 'wide':
        return 3;
      default:
        return 4;
    }
  }

  function buildComparisonDebug(itemData, context) {
    const itemDebugInfo = buildStructuredInfoDebugPayload(itemData);
    return {
      item: {
        id: itemData.id,
        title: itemData.title,
        price: itemData.price,
        categorySlug: itemData.categorySlug,
        statuses: itemData.statuses,
        ...itemDebugInfo,
        analysisGames: itemData.analysisGames.map((game) => ({
          id: game.id,
          title: game.title
        })),
        primaryGames: (itemData.primaryGames || []).map((game) => ({
          id: game.id,
          title: game.title
        }))
      },
      search: {
        path: context.path,
        source: context.source,
        strictFound: context.strictFound,
        totalFound: context.totalFound,
        targetCount: context.targetCount
      },
      requests: context.requests,
      ranked: context.ranked.map((candidate) => ({
        item_id: candidate.item_id,
        title: candidate.title,
        price: candidate.price,
        url: candidate.url,
        ...buildStructuredInfoDebugPayload(candidate),
        score: candidate._score,
        matchedGames: candidate._matchedGames,
        gameCoverage: candidate._gameCoverage,
        tier: candidate._tier
      }))
    };
  }

  function gmRequest(options) {
    if (typeof GM_xmlhttpRequest !== 'function') {
      throw new Error('Tampermonkey API недоступно: GM_xmlhttpRequest не найден.');
    }

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        ...options,
        onload: resolve,
        onerror: reject,
        ontimeout: reject
      });
    });
  }

  // Расчёты и отрисовка результатов
  function buildStats(prices) {
    const sorted = [...prices].sort((a, b) => a - b);
    if (!sorted.length) {
      throw new Error('В выборке нет валидных цен.');
    }

    const sum = sorted.reduce((acc, value) => acc + value, 0);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      median,
      count: sorted.length
    };
  }

  function buildVerdict(currentPrice, stats) {
    if (currentPrice >= stats.median * 1.15) {
      return {
        type: 'lower',
        title: 'Цена выше рынка',
        text: 'Этот лот стоит заметно дороже похожих объявлений.'
      };
    }

    if (currentPrice <= stats.median * 0.88) {
      return {
        type: 'raise',
        title: 'Цена ниже рынка',
        text: 'Этот лот стоит дешевле похожих объявлений.'
      };
    }

    return {
      type: 'keep',
      title: 'Цена в норме',
      text: 'Цена лота находится в обычном диапазоне рынка.'
    };
  }

  function renderAnalysis(itemData, analysis, runButton) {
    const { stats, verdict, comparables, updatedAt, debug, selectionMode } = analysis;
    const currentVsMedian = stats.median ? ((itemData.price - stats.median) / stats.median) * 100 : 0;
    const rows = comparables.slice(0, 8).map((item) => `
      <tr>
        <td><a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title || `Лот ${item.item_id}`)}</a></td>
        <td>${formatPrice(item.price)}</td>
      </tr>
    `).join('');

    setResult(`
      <div class="lztCopilotStats">
        <div class="lztCopilotStat">
          <div class="lztCopilotStat__label muted">Цена лота</div>
          <div class="lztCopilotStat__value">${escapeHtml(formatPrice(itemData.price))}</div>
        </div>
        <div class="lztCopilotStat">
          <div class="lztCopilotStat__label muted">Минимум рынка</div>
          <div class="lztCopilotStat__value">${escapeHtml(formatPrice(stats.min))}</div>
        </div>
        <div class="lztCopilotStat">
          <div class="lztCopilotStat__label muted">Средняя цена</div>
          <div class="lztCopilotStat__value">${escapeHtml(formatPrice(stats.avg))}</div>
        </div>
        <div class="lztCopilotStat">
          <div class="lztCopilotStat__label muted">Медиана</div>
          <div class="lztCopilotStat__value">${escapeHtml(formatPrice(stats.median))}</div>
        </div>
      </div>

      <div class="secondaryContent lztCopilotVerdict lztCopilotVerdict--${escapeHtml(verdict.type)}">
        <div>
          <div class="lztCopilotVerdict__title">${escapeHtml(verdict.title)}</div>
          <div class="lztCopilotVerdict__text muted">
            ${escapeHtml(verdict.text)} Отклонение от медианы: ${escapeHtml(formatSignedPercent(currentVsMedian))}.
          </div>
        </div>
      </div>

      <div class="lztCopilotList">
        <div class="lztCopilotList__title">Ближайшие лоты из выборки</div>
        ${selectionMode === 'broad-fallback' ? '<div class="lztCopilotHint muted">Очень похожих аккаунтов для сравнения не нашлось, поэтому ниже показаны более широкие совпадения по рынку.</div>' : ''}
        <table class="lztCopilotTable">
          <thead>
            <tr>
              <th>Лот</th>
              <th>Цена</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="lztCopilotHint muted">Сравнение выполнено по ${comparables.length} похожим объявлениям.</div>
        <div class="lztCopilotMetaRow">
          <div class="lztCopilotMetaText">Обновлено: ${escapeHtml(formatDateTime(updatedAt))}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${isDebugModeEnabled() ? '<button id="lztCopilotCopyDebug" class="button lztCopilotRefreshButton">Скопировать JSON сравнения</button>' : ''}
            <button id="lztCopilotRefresh" class="button lztCopilotRefreshButton">Обновить</button>
          </div>
        </div>
      </div>
    `);

    const refreshButton = document.getElementById('lztCopilotRefresh');
    refreshButton?.addEventListener('click', async () => {
      invalidateAnalysisCache(itemData);
      await runAnalysis(itemData, runButton);
    });

    const copyDebugButton = document.getElementById('lztCopilotCopyDebug');
    copyDebugButton?.addEventListener('click', async () => {
      await copyComparisonDebug(debug, copyDebugButton);
    });
  }

  function renderListCardLoading(card) {
    const node = ensureListCardNote(card);
    node.innerHTML = '<span class="lztCopilotLoader">Проверяю цену... <span class="lztCopilotLoaderDots"><span></span><span></span><span></span></span></span>';
  }

  function renderListCardAnalysis(card, itemData, analysis) {
    const { stats, verdict, updatedAt } = analysis;
    const node = ensureListCardNote(card);
    const deviation = stats.median ? formatSignedPercent(((itemData.price - stats.median) / stats.median) * 100) : '0%';
    node.innerHTML = `
      <div><strong>Средняя по рынку: ${escapeHtml(formatPrice(stats.avg))}</strong></div>
      <div class="lztCopilotListCardMuted">Медиана: ${escapeHtml(formatPrice(stats.median))} · Отклонение: ${escapeHtml(deviation)}</div>
      <div class="lztCopilotListCardMuted">${escapeHtml(verdict.title)}</div>
      <div class="lztCopilotMetaRow">
        <div class="lztCopilotMetaText">Обновлено: ${escapeHtml(formatDateTime(updatedAt))}</div>
        <button class="button lztCopilotRefreshButton" type="button">Обновить</button>
      </div>
    `;

    const refreshButton = node.querySelector('.lztCopilotRefreshButton');
    refreshButton?.addEventListener('click', async () => {
      refreshButton.disabled = true;
      try {
        invalidateAnalysisCache(itemData);
        await analyzeListCard(card, getStoredToken());
      } catch (error) {
        console.error('[LZT Market Copilot] list card refresh failed', error);
        renderListCardError(card, error.message || 'Ошибка обновления');
      }
    });
  }

  function renderListCardError(card, message) {
    const node = ensureListCardNote(card);
    node.innerHTML = `<div class="lztCopilotListCardMuted">${escapeHtml(message)}</div>`;
  }

  function renderListCardUnsupported(card, categorySlug) {
    const node = ensureListCardNote(card);
    node.innerHTML = `<div class="lztCopilotListCardMuted">${escapeHtml(getUnsupportedCategoryMessage(categorySlug))}</div>`;
  }

  function ensureListCardNote(card) {
    let note = card.querySelector('.lztCopilotListCardNote');
    if (note) {
      return note;
    }

    note = document.createElement('div');
    note.className = 'lztCopilotListCardNote';

    const insertAfterTarget = card.querySelector(
      '.marketIndexItem--buttons, .marketIndexItem--footer, .marketIndexItem--actions, .marketIndexItem--bottom'
    );

    if (insertAfterTarget?.parentNode) {
      insertAfterTarget.insertAdjacentElement('afterend', note);
      return note;
    }

    const appendTarget = card.querySelector(
      '.marketIndexItem--otherInfo, .marketIndexItem--description, .marketIndexItem--container, .marketIndexItem--content'
    ) || card;

    appendTarget.appendChild(note);
    return note;
  }

  function setStatus(text) {
    const node = document.getElementById('lztCopilotStatus');
    if (node) {
      node.textContent = text;
    }
  }

  function setListStatus(html) {
    const node = document.getElementById('lztCopilotListStatus');
    if (node) {
      node.innerHTML = html;
    }
  }

  function setLoadingState() {
    const node = document.getElementById('lztCopilotStatus');
    if (node) {
      node.innerHTML = '<span class="lztCopilotLoader">Проверяю цену... <span class="lztCopilotLoaderDots"><span></span><span></span><span></span></span></span>';
    }
    setResult('');
  }

  function setResult(html) {
    const node = document.getElementById('lztCopilotResult');
    if (node) {
      node.innerHTML = html;
    }
  }

  async function copyComparisonDebug(debugData, button) {
    if (!debugData) {
      return;
    }

    const originalText = button?.textContent || '';

    try {
      await navigator.clipboard.writeText(JSON.stringify(debugData, null, 2));
      if (button) {
        button.textContent = 'JSON скопирован';
      }
    } catch (error) {
      console.error('[LZT Market Copilot] copy debug failed', error);
      if (button) {
        button.textContent = 'Ошибка копирования';
      }
    }

    if (button) {
      window.setTimeout(() => {
        button.textContent = originalText;
      }, 1500);
    }
  }

  // Утилиты
  function extractMinecraftInfo(root) {
    const counters = [...root.querySelectorAll('.marketItemView--ParsedInfo .counter')];
    if (!counters.length) {
      return null;
    }

    const info = {
      username: '',
      java: null,
      bedrock: null,
      dungeons: null,
      legends: null,
      canChangeNickname: null,
      minecoins: null,
      capesCount: null,
      hypixelRank: '',
      hypixelLevel: null,
      hypixelAchievement: null,
      hypixelSkyblockLevel: null,
      hypixelSkyblockNetWorth: null,
      hypixelApi: null,
      hypixelBan: 'unknown',
      emailDomain: ''
    };

    for (const counter of counters) {
      const label = cleanText(counter.querySelector('.muted')?.textContent);
      if (!label) {
        continue;
      }

      const valueNode = counter.querySelector('.label');
      const rawValue = cleanText(valueNode?.textContent);

      switch (label.toLowerCase()) {
        case 'имя пользователя':
          info.username = rawValue;
          break;
        case 'java edition':
          info.java = parseYesNoValue(rawValue);
          break;
        case 'bedrock edition':
          info.bedrock = parseYesNoValue(rawValue);
          break;
        case 'minecraft dungeons':
          info.dungeons = parseYesNoValue(rawValue);
          break;
        case 'minecraft legends':
          info.legends = parseYesNoValue(rawValue);
          break;
        case 'возможность смены ника':
          info.canChangeNickname = parseYesNoValue(rawValue);
          break;
        case 'minecoins':
          info.minecoins = parseLooseNumber(rawValue);
          break;
        case 'плащей':
          info.capesCount = parseLooseNumber(rawValue);
          break;
        case 'ранг (hypixel)':
          info.hypixelRank = rawValue;
          break;
        case 'уровень (hypixel)':
          info.hypixelLevel = parseLooseNumber(rawValue);
          break;
        case 'достижений (hypixel)':
          info.hypixelAchievement = parseLooseNumber(rawValue);
          break;
        case 'уровень (hypixel skyblock)':
          info.hypixelSkyblockLevel = parseLooseNumber(rawValue);
          break;
        case 'hypixel skyblock net worth':
          info.hypixelSkyblockNetWorth = parseMinecraftNetWorth(rawValue, valueNode?.getAttribute('title'));
          break;
        case 'hypixel api':
          info.hypixelApi = parseYesNoValue(rawValue);
          break;
        case 'бан на hypixel':
          info.hypixelBan = parseHypixelBan(rawValue);
          break;
        case 'почтовый домен':
          info.emailDomain = rawValue.toLowerCase();
          break;
        default:
          break;
      }
    }

    return info;
  }

  function extractFortniteInfo(root, title) {
    const counters = [...root.querySelectorAll('.marketFortniteCommonInfo .counter')];
    const skins = extractFortniteCosmetics(root, 'fortnite_skins');
    const pickaxes = extractFortniteCosmetics(root, 'fortnite_pickaxe');
    const dances = extractFortniteCosmetics(root, 'fortnite_dance');
    const gliders = extractFortniteCosmetics(root, 'fortnite_gliders');
    const headlineSkins = resolveFeaturedFortniteSkins(title, skins);

    const info = {
      linkedAccounts: [],
      changeEmail: null,
      lastActivityAt: null,
      level: null,
      balance: null,
      platform: '',
      lifetimeWins: null,
      currentSeason: null,
      battlePass: null,
      bookLevel: null,
      refundCredits: null,
      friendsCount: null,
      registerDate: null,
      country: '',
      xboxLinkable: null,
      psnLinkable: null,
      rlPurchases: null,
      emailDomain: '',
      skinCount: skins.length,
      pickaxeCount: pickaxes.length,
      danceCount: dances.length,
      gliderCount: gliders.length,
      headlineSkins,
      featuredSkins: skins.slice(0, 8),
      featuredPickaxes: pickaxes.slice(0, 6),
      featuredDances: dances.slice(0, 6),
      featuredGliders: gliders.slice(0, 6)
    };

    for (const counter of counters) {
      const label = cleanText(counter.querySelector('.muted')?.textContent);
      if (!label) {
        continue;
      }

      const valueNode = counter.querySelector('.label');
      const rawValue = cleanText(valueNode?.textContent);
      switch (label.toLowerCase()) {
        case 'привязки к соц. сетям':
          info.linkedAccounts = rawValue.split(/[,+]/).map((part) => cleanText(part)).filter(Boolean);
          break;
        case 'возможность смены почты':
          info.changeEmail = parseYesNoValue(rawValue);
          break;
        case 'последняя активность':
          info.lastActivityAt = parseDateTimeValue(valueNode);
          break;
        case 'уровень аккаунта':
          info.level = parseLooseNumber(rawValue);
          break;
        case 'баланс':
          info.balance = parseLooseNumber(rawValue);
          info.platform = cleanText((rawValue.match(/\(([^)]+)\)/) || [])[1] || '');
          break;
        case 'всего побед':
          info.lifetimeWins = parseLooseNumber(rawValue);
          break;
        case 'последний сезон':
          info.currentSeason = parseLooseNumber(rawValue);
          break;
        case 'battle pass':
          info.battlePass = parseYesNoValue(rawValue);
          break;
        case 'уровень battle pass':
          info.bookLevel = parseLooseNumber(rawValue);
          break;
        case 'билеты возврата':
          info.refundCredits = parseLooseNumber(rawValue);
          break;
        case 'друзей':
          info.friendsCount = parseLooseNumber(rawValue);
          break;
        case 'регистрация аккаунта':
          info.registerDate = parseDateTimeValue(valueNode);
          break;
        case 'страна':
          info.country = rawValue;
          break;
        case 'платформа':
          info.platform = rawValue || info.platform;
          break;
        case 'возможность привязать xbox':
          info.xboxLinkable = parseMaybeValue(rawValue);
          break;
        case 'возможность привязать psn':
          info.psnLinkable = parseMaybeValue(rawValue);
          break;
        case 'есть донат в rocket league':
          info.rlPurchases = parseYesNoValue(rawValue);
          break;
        case 'почтовый домен':
          info.emailDomain = rawValue.toLowerCase();
          break;
        default:
          break;
      }
    }

    return info;
  }

  function extractRobloxInfo(root, title) {
    const counters = [...root.querySelectorAll('.marketItemView--ParsedInfo .counter')];
    if (!counters.length) {
      return null;
    }

    const titleStats = extractRobloxTitleStats(title);
    const info = {
      username: '',
      country: '',
      ageGroup: '',
      registerDate: null,
      subscriptionAutoRenew: null,
      socialLinks: null,
      robux: null,
      verified: null,
      ageVerified: null,
      voice: null,
      emailVerified: null,
      friends: null,
      followers: null,
      creditBalance: null,
      inventoryPrice: null,
      limitedPrice: null,
      ugcLimitedPrice: null,
      gamepassTotal: null,
      donationTotal: titleStats.donationTotal,
      incomeTotal: titleStats.incomeTotal,
      offsaleCount: null,
      emailDomain: '',
      origin: ''
    };

    for (const counter of counters) {
      const label = cleanText(counter.querySelector('.muted')?.textContent);
      if (!label) {
        continue;
      }

      const valueNode = counter.querySelector('.label');
      const rawValue = cleanText(valueNode?.textContent);
      switch (label.toLowerCase()) {
        case 'имя пользователя':
          info.username = rawValue;
          break;
        case 'страна':
          info.country = normalizeCountryValue(rawValue);
          break;
        case 'возрастная группа':
          info.ageGroup = rawValue;
          break;
        case 'регистрация аккаунта':
          info.registerDate = parseDateTimeValue(valueNode);
          break;
        case 'автопродление подписки':
          info.subscriptionAutoRenew = parseYesNoValue(rawValue);
          break;
        case 'привязки к соц. сетям':
          info.socialLinks = parseYesNoValue(rawValue);
          break;
        case 'робукс':
          info.robux = parseLooseNumber(rawValue);
          break;
        case 'верификация':
          info.verified = parseYesNoValue(rawValue);
          break;
        case 'возраст подтвержден':
          info.ageVerified = parseYesNoValue(rawValue);
          break;
        case 'доступен голосовой чат':
          info.voice = parseYesNoValue(rawValue);
          break;
        case 'почта подтверждена':
          info.emailVerified = parseYesNoValue(rawValue);
          break;
        case 'друзей':
          info.friends = parseLooseNumber(rawValue);
          break;
        case 'подписчиков':
          info.followers = parseLooseNumber(rawValue);
          break;
        case 'кредитный баланс':
          info.creditBalance = parseLooseNumber(rawValue);
          break;
        case 'стоимость инвентаря':
          info.inventoryPrice = parseLooseNumber(rawValue);
          break;
        case 'rap лимитированных вещей':
          info.limitedPrice = parseLooseNumber(rawValue);
          break;
        case 'rap ugc':
          info.ugcLimitedPrice = parseLooseNumber(rawValue);
          break;
        case 'геймпассы':
          info.gamepassTotal = parseLooseNumber(rawValue);
          break;
        case 'offsale вещей':
          info.offsaleCount = parseLooseNumber(rawValue);
          break;
        case 'почтовый домен':
          info.emailDomain = rawValue.toLowerCase();
          break;
        case 'происхождение аккаунта':
          info.origin = rawValue.toLowerCase();
          break;
        default:
          break;
      }
    }

    if (!Number.isFinite(info.robux) && Number.isFinite(titleStats.robux)) {
      info.robux = titleStats.robux;
    }
    if (!Number.isFinite(info.inventoryPrice) && Number.isFinite(titleStats.inventoryPrice)) {
      info.inventoryPrice = titleStats.inventoryPrice;
    }
    if (!Number.isFinite(info.gamepassTotal) && Number.isFinite(titleStats.gamepassTotal)) {
      info.gamepassTotal = titleStats.gamepassTotal;
    }
    if (!Number.isFinite(info.offsaleCount) && Number.isFinite(titleStats.offsaleCount)) {
      info.offsaleCount = titleStats.offsaleCount;
    }
    if (info.voice === null && titleStats.voice === true) {
      info.voice = true;
    }

    return info;
  }

  function extractRiotInfo(root, title) {
    const sections = [...root.querySelectorAll('h2, h4')];
    const valorantHeader = sections.find((node) => /^valorant$/i.test(cleanText(node.textContent)));
    const countersGroups = [...root.querySelectorAll('.marketItemView--counters')];
    const valorantCounters = valorantHeader?.nextElementSibling?.matches('.marketItemView--counters')
      ? [...valorantHeader.nextElementSibling.querySelectorAll('.counter')]
      : (countersGroups[0] ? [...countersGroups[0].querySelectorAll('.counter')] : []);
    const commonCounters = countersGroups[1] ? [...countersGroups[1].querySelectorAll('.counter')] : [];
    const titleData = extractRiotTitleData(title);

    const info = {
      mode: titleData.mode,
      titleTags: titleData.titleTags,
      titleCompareTags: titleData.titleCompareTags,
      lastActivityAt: null,
      emailLinked: null,
      country: '',
      phoneVerified: null,
      emailDomain: '',
      origin: '',
      valorant: {
        inventoryValue: titleData.valorant.inventoryValue,
        vp: null,
        rp: null,
        freeAgents: null,
        agentCount: titleData.valorant.agentCount,
        currentRankText: '',
        currentRankValue: null,
        previousRankText: '',
        previousRankValue: null,
        lastRankText: '',
        lastRankValue: null,
        level: null,
        knifeCount: null,
        region: '',
        skinCount: titleData.valorant.skinCount
      },
      lol: {
        region: titleData.lol.region,
        championCount: titleData.lol.championCount,
        skinCount: titleData.lol.skinCount,
        level: titleData.lol.level,
        blueEssence: null,
        orangeEssence: null,
        mythicEssence: null,
        riotPoints: null,
        rank: titleData.lol.rank,
        winRate: null
      }
    };

    for (const counter of valorantCounters) {
      const label = cleanText(counter.querySelector('.muted')?.textContent);
      if (!label) {
        continue;
      }

      const valueNode = counter.querySelector('.label');
      const rawValue = cleanText(valueNode?.textContent);
      switch (label.toLowerCase()) {
        case 'стоимость инвентаря':
          info.valorant.inventoryValue = parseLooseNumber(rawValue);
          info.mode = 'valorant';
          break;
        case 'valorant points':
          info.valorant.vp = parseLooseNumber(rawValue);
          info.mode = 'valorant';
          break;
        case 'radiant points':
          info.valorant.rp = parseLooseNumber(rawValue);
          info.mode = 'valorant';
          break;
        case 'free agents':
          info.valorant.freeAgents = parseLooseNumber(rawValue);
          info.mode = 'valorant';
          break;
        case 'агентов':
          info.valorant.agentCount = parseLooseNumber(rawValue);
          info.mode = 'valorant';
          break;
        case 'текущий ранг':
          info.valorant.currentRankText = rawValue;
          info.valorant.currentRankValue = parseValorantRankValue(rawValue);
          info.mode = 'valorant';
          break;
        case 'ранг прошлого сезона':
          info.valorant.previousRankText = rawValue;
          info.valorant.previousRankValue = parseValorantRankValue(rawValue);
          info.mode = 'valorant';
          break;
        case 'последний ранг':
          info.valorant.lastRankText = rawValue;
          info.valorant.lastRankValue = parseValorantRankValue(rawValue);
          info.mode = 'valorant';
          break;
        case 'уровень':
          info.valorant.level = parseLooseNumber(rawValue);
          info.mode = 'valorant';
          break;
        case 'нож':
          info.valorant.knifeCount = parseLooseNumber(rawValue);
          info.mode = 'valorant';
          break;
        case 'регион':
          info.valorant.region = normalizeRiotRegion(rawValue);
          info.mode = 'valorant';
          break;
        default:
          break;
      }
    }

    for (const counter of commonCounters) {
      const label = cleanText(counter.querySelector('.muted')?.textContent);
      if (!label) {
        continue;
      }

      const valueNode = counter.querySelector('.label');
      const rawValue = cleanText(valueNode?.textContent);
      switch (label.toLowerCase()) {
        case 'последняя активность':
          info.lastActivityAt = parseDateTimeValue(valueNode);
          break;
        case 'привязка к почте':
          info.emailLinked = parseYesNoValue(rawValue);
          break;
        case 'страна':
          info.country = normalizeCountryValue(rawValue);
          break;
        case 'телефон привязан':
          info.phoneVerified = parseYesNoValue(rawValue);
          break;
        case 'почтовый домен':
          info.emailDomain = rawValue.toLowerCase();
          break;
        case 'происхождение аккаунта':
          info.origin = rawValue.toLowerCase();
          break;
        default:
          break;
      }
    }

    return info;
  }

  function extractFortniteCosmetics(root, key) {
    const list = root.querySelector(`[data-key="${key}"]`);
    if (!list) {
      return [];
    }

    return [...list.querySelectorAll('li.item[data-id]')].map((item) => ({
      id: cleanText(item.getAttribute('data-id')),
      title: cleanText(item.querySelector('.bold')?.textContent || item.querySelector('img')?.getAttribute('alt'))
    })).filter((item) => item.id && item.title);
  }

  function getMinecraftComparableMetrics(itemData, candidate) {
    const source = itemData.minecraftInfo || {};
    const target = candidate.minecraftInfo || {};
    let score = 0;
    let matchedFields = 0;
    let comparableFields = 0;

    const compareBoolean = (sourceValue, targetValue, weight) => {
      if (typeof sourceValue !== 'boolean' || typeof targetValue !== 'boolean') {
        return;
      }

      comparableFields += 1;
      if (sourceValue === targetValue) {
        matchedFields += 1;
        score += weight;
      }
    };

    const compareStatus = (sourceValue, targetValue, weight) => {
      if (!sourceValue || sourceValue === 'unknown' || !targetValue || targetValue === 'unknown') {
        return;
      }

      comparableFields += 1;
      if (sourceValue === targetValue) {
        matchedFields += 1;
        score += weight;
      }
    };

    const compareRank = (sourceValue, targetValue, weight) => {
      const left = cleanText(sourceValue).toUpperCase();
      const right = cleanText(targetValue).toUpperCase();
      if (!left && !right) {
        comparableFields += 1;
        matchedFields += 1;
        score += weight;
        return;
      }

      if (!left || !right) {
        comparableFields += 1;
        score -= weight * 0.75;
        return;
      }

      comparableFields += 1;
      if (left === right) {
        matchedFields += 1;
        score += weight;
        return;
      }

      if (left.includes(right) || right.includes(left)) {
        score += weight * 0.3;
        return;
      }

      score -= weight * 0.65;
    };

    const compareNumeric = (sourceValue, targetValue, weight, toleranceRatio, floorTolerance) => {
      if (!Number.isFinite(sourceValue) || !Number.isFinite(targetValue)) {
        return;
      }

      comparableFields += 1;
      const delta = Math.abs(sourceValue - targetValue);
      const tolerance = Math.max(floorTolerance, Math.abs(sourceValue) * toleranceRatio);

      if (delta <= tolerance) {
        matchedFields += 1;
        score += weight;
        return;
      }

      const partial = Math.max(0, 1 - delta / Math.max(tolerance * 2, 1));
      score += weight * partial * 0.45;
    };

    compareBoolean(source.java, target.java, 10);
    compareBoolean(source.bedrock, target.bedrock, 10);
    compareBoolean(source.canChangeNickname, target.canChangeNickname, 12);
    compareBoolean(source.dungeons, target.dungeons, 5);
    compareBoolean(source.legends, target.legends, 5);
    compareBoolean(source.hypixelApi, target.hypixelApi, 8);
    compareStatus(source.hypixelBan, target.hypixelBan, 10);
    compareRank(source.hypixelRank, target.hypixelRank, 9);

    compareNumeric(source.minecoins, target.minecoins, 8, 0.8, 50);
    compareNumeric(source.capesCount, target.capesCount, 8, 0.6, 1);
    compareNumeric(source.hypixelLevel, target.hypixelLevel, 10, 0.6, 5);
    compareNumeric(source.hypixelAchievement, target.hypixelAchievement, 10, 0.65, 300);
    compareNumeric(source.hypixelSkyblockLevel, target.hypixelSkyblockLevel, 8, 0.75, 4);
    compareNumeric(source.hypixelSkyblockNetWorth, target.hypixelSkyblockNetWorth, 12, 0.75, 15000);

    if (source.emailDomain && target.emailDomain) {
      comparableFields += 1;
      if (source.emailDomain === target.emailDomain) {
        matchedFields += 1;
        score += 3;
      }
    }

    const sourceSkyblockValue = (source.hypixelSkyblockLevel || 0) * 2500000 + (source.hypixelSkyblockNetWorth || 0);
    const targetSkyblockValue = (target.hypixelSkyblockLevel || 0) * 2500000 + (target.hypixelSkyblockNetWorth || 0);
    const sourceHypixelValue = (source.hypixelLevel || 0) * 900 + (source.hypixelAchievement || 0);
    const targetHypixelValue = (target.hypixelLevel || 0) * 900 + (target.hypixelAchievement || 0);

    if (sourceSkyblockValue > 0 && targetSkyblockValue > 0) {
      const skyblockRatio = Math.max(sourceSkyblockValue, targetSkyblockValue) / Math.max(Math.min(sourceSkyblockValue, targetSkyblockValue), 1);
      if (skyblockRatio >= 12) {
        score -= 22;
      } else if (skyblockRatio >= 6) {
        score -= 14;
      } else if (skyblockRatio >= 3) {
        score -= 7;
      }
    }

    if (sourceSkyblockValue > 0 && targetSkyblockValue <= 0) {
      score -= sourceSkyblockValue >= 15000000 ? 18 : 12;
    }

    if (sourceSkyblockValue <= 0 && targetSkyblockValue > 0) {
      score -= targetSkyblockValue >= 15000000 ? 18 : 12;
    }

    if (sourceHypixelValue > 0 && targetHypixelValue > 0) {
      const hypixelRatio = Math.max(sourceHypixelValue, targetHypixelValue) / Math.max(Math.min(sourceHypixelValue, targetHypixelValue), 1);
      if (hypixelRatio >= 6) {
        score -= 10;
      } else if (hypixelRatio >= 3) {
        score -= 5;
      }
    }

    if ((source.hypixelSkyblockLevel || 0) > 0 && (target.hypixelSkyblockLevel || 0) <= 0) {
      score -= 6;
    }

    if ((source.hypixelSkyblockNetWorth || 0) > 0 && (target.hypixelSkyblockNetWorth || 0) <= 0) {
      score -= 6;
    }

    const oneHasMeaningfulSkyblock = sourceSkyblockValue >= 30000000 || targetSkyblockValue >= 30000000;
    const hugeSkyblockGap = Math.abs((source.hypixelSkyblockLevel || 0) - (target.hypixelSkyblockLevel || 0)) >= 18;
    if (oneHasMeaningfulSkyblock && hugeSkyblockGap) {
      score -= 12;
    }

    const oneHasRank = Boolean(cleanText(source.hypixelRank)) !== Boolean(cleanText(target.hypixelRank));
    if (oneHasRank) {
      score -= 6;
    }

    const priceDelta = Math.abs(candidate.price - itemData.price) / Math.max(itemData.price, 1);
    score += Math.max(0, 14 - priceDelta * 18);

    const coverage = comparableFields ? matchedFields / comparableFields : 0;
    let tier = 'wide';
    if (coverage >= 0.9 && matchedFields >= 7 && score >= 92) {
      tier = 'exact';
    } else if (coverage >= 0.76 && matchedFields >= 6 && score >= 72) {
      tier = 'close';
    } else if (coverage >= 0.58 && matchedFields >= 5 && score >= 48) {
      tier = 'medium';
    } else if (coverage <= 0) {
      tier = 'none';
    }

    return {
      score: Math.round(score * 100) / 100,
      matchedGames: matchedFields,
      gameCoverage: coverage,
      tier,
      tierRank: getComparableTierRank(tier)
    };
  }

  function getFortniteComparableMetrics(itemData, candidate) {
    const source = itemData.fortniteInfo || {};
    const target = candidate.fortniteInfo || {};
    let score = 0;
    let matchedFields = 0;
    let comparableFields = 0;

    const compareBoolean = (sourceValue, targetValue, weight) => {
      if (typeof sourceValue !== 'boolean' || typeof targetValue !== 'boolean') {
        return;
      }

      comparableFields += 1;
      if (sourceValue === targetValue) {
        matchedFields += 1;
        score += weight;
      }
    };

    const compareMaybe = (sourceValue, targetValue, weight) => {
      if (sourceValue === null || targetValue === null || sourceValue === undefined || targetValue === undefined) {
        return;
      }

      comparableFields += 1;
      if (sourceValue === targetValue) {
        matchedFields += 1;
        score += weight;
      } else if (sourceValue === 'maybe' || targetValue === 'maybe') {
        score += weight * 0.25;
      }
    };

    const compareString = (sourceValue, targetValue, weight) => {
      const left = cleanText(sourceValue).toLowerCase();
      const right = cleanText(targetValue).toLowerCase();
      if (!left || !right) {
        return;
      }

      comparableFields += 1;
      if (left === right) {
        matchedFields += 1;
        score += weight;
      }
    };

    const compareNumeric = (sourceValue, targetValue, weight, toleranceRatio, floorTolerance) => {
      if (!Number.isFinite(sourceValue) || !Number.isFinite(targetValue)) {
        return;
      }

      comparableFields += 1;
      const delta = Math.abs(sourceValue - targetValue);
      const tolerance = Math.max(floorTolerance, Math.abs(sourceValue) * toleranceRatio);
      if (delta <= tolerance) {
        matchedFields += 1;
        score += weight;
        return;
      }

      const partial = Math.max(0, 1 - delta / Math.max(tolerance * 2, 1));
      score += weight * partial * 0.42;
    };

    const compareCosmetics = (sourceList, targetList, weight, options = {}) => {
      if (!sourceList?.length || !targetList?.length) {
        if (options.penalizeMissing && sourceList?.length) {
          score -= options.penaltyWeight ?? weight * 0.5;
        }
        return;
      }

      const sourceIds = new Set(sourceList.map((item) => item.id));
      const targetIds = new Set(targetList.map((item) => item.id));
      let matches = 0;
      for (const id of sourceIds) {
        if (targetIds.has(id)) {
          matches += 1;
        }
      }

      comparableFields += 1;
      if (!matches) {
        if (options.penalizeMissing) {
          score -= options.penaltyWeight ?? weight * 0.65;
        }
        return;
      }

      const ratio = matches / sourceIds.size;
      if (ratio >= 0.7) {
        matchedFields += 1;
      }
      score += ratio * weight;

       if (options.penalizeMissing && ratio < (options.minRatio ?? 0.34)) {
        score -= options.penaltyWeight ?? weight * 0.35;
      }
    };

    compareString(source.platform, target.platform, 10);
    compareBoolean(source.changeEmail, target.changeEmail, 10);
    compareBoolean(source.battlePass, target.battlePass, 5);
    compareMaybe(source.xboxLinkable, target.xboxLinkable, 4);
    compareMaybe(source.psnLinkable, target.psnLinkable, 4);
    compareBoolean(source.rlPurchases, target.rlPurchases, 4);
    compareString(source.country, target.country, 2);

    compareNumeric(source.skinCount, target.skinCount, 14, 0.22, 12);
    compareNumeric(source.pickaxeCount, target.pickaxeCount, 8, 0.25, 10);
    compareNumeric(source.danceCount, target.danceCount, 8, 0.25, 10);
    compareNumeric(source.gliderCount, target.gliderCount, 7, 0.22, 8);
    compareNumeric(source.balance, target.balance, 8, 0.55, 200);
    compareNumeric(source.level, target.level, 10, 0.22, 35);
    compareNumeric(source.lifetimeWins, target.lifetimeWins, 7, 0.45, 20);
    compareNumeric(source.bookLevel, target.bookLevel, 5, 0.45, 8);
    compareNumeric(source.refundCredits, target.refundCredits, 4, 0.5, 1);

    compareCosmetics(source.headlineSkins?.length ? source.headlineSkins : source.featuredSkins, target.featuredSkins, 54, {
      penalizeMissing: true,
      penaltyWeight: 24,
      minRatio: 0.4
    });
    compareCosmetics(source.featuredSkins, target.featuredSkins, 18);
    compareCosmetics(source.featuredPickaxes, target.featuredPickaxes, 10);
    compareCosmetics(source.featuredGliders, target.featuredGliders, 8);
    compareCosmetics(source.featuredDances, target.featuredDances, 6);

    if (source.linkedAccounts?.length && target.linkedAccounts?.length) {
      comparableFields += 1;
      const left = new Set(source.linkedAccounts.map((item) => item.toLowerCase()));
      const right = new Set(target.linkedAccounts.map((item) => item.toLowerCase()));
      let matches = 0;
      for (const item of left) {
        if (right.has(item)) {
          matches += 1;
        }
      }
      if (matches) {
        matchedFields += 1;
        score += (matches / left.size) * 5;
      }
    }

    if (source.skinCount >= 40 && target.skinCount < Math.max(10, source.skinCount * 0.5)) {
      score -= 16;
    }

    if (source.skinCount >= 80 && target.skinCount < Math.max(25, source.skinCount * 0.65)) {
      score -= 12;
    }

    if ((source.headlineSkins?.length || 0) >= 3) {
      const targetSkinIds = new Set((target.featuredSkins || []).map((item) => item.id));
      const headlineMatches = (source.headlineSkins || []).filter((item) => targetSkinIds.has(item.id)).length;
      if (!headlineMatches) {
        score -= 18;
      } else if (headlineMatches === 1) {
        score -= 8;
      }
    }

    const priceDelta = Math.abs(candidate.price - itemData.price) / Math.max(itemData.price, 1);
    score += Math.max(0, 14 - priceDelta * 18);

    const coverage = comparableFields ? matchedFields / comparableFields : 0;
    let tier = 'wide';
    if (coverage >= 0.84 && score >= 86) {
      tier = 'exact';
    } else if (coverage >= 0.68 && score >= 64) {
      tier = 'close';
    } else if (coverage >= 0.5 && score >= 42) {
      tier = 'medium';
    } else if (coverage <= 0) {
      tier = 'none';
    }

    return {
      score: Math.round(score * 100) / 100,
      matchedGames: matchedFields,
      gameCoverage: coverage,
      tier,
      tierRank: getComparableTierRank(tier)
    };
  }

  function getRobloxComparableMetrics(itemData, candidate) {
    const source = itemData.robloxInfo || {};
    const target = candidate.robloxInfo || {};
    let score = 0;
    let matchedFields = 0;
    let comparableFields = 0;

    const compareBoolean = (sourceValue, targetValue, weight) => {
      if (typeof sourceValue !== 'boolean' || typeof targetValue !== 'boolean') {
        return;
      }

      comparableFields += 1;
      if (sourceValue === targetValue) {
        matchedFields += 1;
        score += weight;
      }
    };

    const compareString = (sourceValue, targetValue, weight) => {
      const left = cleanText(sourceValue).toLowerCase();
      const right = cleanText(targetValue).toLowerCase();
      if (!left || !right) {
        return;
      }

      comparableFields += 1;
      if (left === right) {
        matchedFields += 1;
        score += weight;
      }
    };

    const compareCountry = (sourceValue, targetValue, weight) => {
      const left = cleanText(sourceValue);
      const right = cleanText(targetValue);
      if (!left || !right) {
        return;
      }

      if (!looksLikeCountryCode(left) || !looksLikeCountryCode(right)) {
        return;
      }

      comparableFields += 1;
      if (left === right) {
        matchedFields += 1;
        score += weight;
      }
    };

    const compareNumeric = (sourceValue, targetValue, weight, toleranceRatio, floorTolerance) => {
      if (!Number.isFinite(sourceValue) || !Number.isFinite(targetValue)) {
        return;
      }

      comparableFields += 1;
      const delta = Math.abs(sourceValue - targetValue);
      const tolerance = Math.max(floorTolerance, Math.abs(sourceValue) * toleranceRatio);
      if (delta <= tolerance) {
        matchedFields += 1;
        score += weight;
        return;
      }

      const partial = Math.max(0, 1 - delta / Math.max(tolerance * 2, 1));
      score += weight * partial * 0.42;
    };

    compareString(source.ageGroup, target.ageGroup, 12);
    compareCountry(source.country, target.country, 3);
    compareString(source.origin, target.origin, 6);
    compareBoolean(source.voice, target.voice, 12);
    compareBoolean(source.ageVerified, target.ageVerified, 14);
    compareBoolean(source.verified, target.verified, 10);
    compareBoolean(source.emailVerified, target.emailVerified, 8);
    compareBoolean(source.subscriptionAutoRenew, target.subscriptionAutoRenew, 4);
    compareBoolean(source.socialLinks, target.socialLinks, 3);

    compareNumeric(source.robux, target.robux, 8, 0.6, 40);
    compareNumeric(source.friends, target.friends, 4, 0.45, 8);
    compareNumeric(source.followers, target.followers, 4, 0.55, 5);
    compareNumeric(source.creditBalance, target.creditBalance, 4, 0.55, 25);
    compareNumeric(source.inventoryPrice, target.inventoryPrice, 16, 0.3, 140);
    compareNumeric(source.limitedPrice, target.limitedPrice, 10, 0.4, 80);
    compareNumeric(source.ugcLimitedPrice, target.ugcLimitedPrice, 8, 0.4, 80);
    compareNumeric(source.gamepassTotal, target.gamepassTotal, 14, 0.35, 160);
    compareNumeric(source.donationTotal, target.donationTotal, 10, 0.4, 180);
    compareNumeric(source.incomeTotal, target.incomeTotal, 12, 0.4, 300);
    compareNumeric(source.offsaleCount, target.offsaleCount, 8, 0.35, 2);

    if (source.emailDomain && target.emailDomain) {
      comparableFields += 1;
      if (source.emailDomain === target.emailDomain) {
        matchedFields += 1;
        score += 3;
      }
    }

    const sourceValueTotal = (source.inventoryPrice || 0) + (source.gamepassTotal || 0) + (source.limitedPrice || 0) + (source.ugcLimitedPrice || 0) + (source.robux || 0);
    const targetValueTotal = (target.inventoryPrice || 0) + (target.gamepassTotal || 0) + (target.limitedPrice || 0) + (target.ugcLimitedPrice || 0) + (target.robux || 0);
    const gamepassRatio = (source.gamepassTotal || 0) > 0 ? (target.gamepassTotal || 0) / Math.max(source.gamepassTotal, 1) : null;
    const inventoryRatio = (source.inventoryPrice || 0) > 0 ? (target.inventoryPrice || 0) / Math.max(source.inventoryPrice, 1) : null;
    const donationRatio = (source.donationTotal || 0) > 0 ? (target.donationTotal || 0) / Math.max(source.donationTotal, 1) : null;
    const incomeRatio = (source.incomeTotal || 0) > 0 ? (target.incomeTotal || 0) / Math.max(source.incomeTotal, 1) : null;
    const totalValueRatio = sourceValueTotal > 0 ? targetValueTotal / Math.max(sourceValueTotal, 1) : null;
    if (sourceValueTotal > 0 && targetValueTotal > 0) {
      const ratio = Math.max(sourceValueTotal, targetValueTotal) / Math.max(Math.min(sourceValueTotal, targetValueTotal), 1);
      if (ratio >= 8) {
        score -= 18;
      } else if (ratio >= 4) {
        score -= 10;
      } else if (ratio >= 2.5) {
        score -= 5;
      }
    }

    if ((source.inventoryPrice || 0) >= 1000 && (target.inventoryPrice || 0) <= 0) {
      score -= 16;
    }

    if ((source.gamepassTotal || 0) >= 1000 && (target.gamepassTotal || 0) <= 0) {
      score -= 14;
    }

    if ((source.gamepassTotal || 0) >= 700) {
      if ((target.gamepassTotal || 0) <= 0) {
        score -= 22;
      } else if ((target.gamepassTotal || 0) < source.gamepassTotal * 0.45) {
        score -= 15;
      } else if ((target.gamepassTotal || 0) < source.gamepassTotal * 0.65) {
        score -= 8;
      }
    }

    if ((source.inventoryPrice || 0) >= 250) {
      if ((target.inventoryPrice || 0) <= 0) {
        score -= 18;
      } else if ((target.inventoryPrice || 0) < source.inventoryPrice * 0.4) {
        score -= 12;
      } else if ((target.inventoryPrice || 0) < source.inventoryPrice * 0.6) {
        score -= 6;
      }
    }

    if ((source.incomeTotal || 0) >= 1200) {
      if ((target.incomeTotal || 0) <= 0) {
        score -= 14;
      } else if ((target.incomeTotal || 0) < source.incomeTotal * 0.35) {
        score -= 10;
      } else if ((target.incomeTotal || 0) < source.incomeTotal * 0.55) {
        score -= 5;
      }
    }

    if ((source.donationTotal || 0) >= 700) {
      if ((target.donationTotal || 0) <= 0) {
        score -= 12;
      } else if ((target.donationTotal || 0) < source.donationTotal * 0.4) {
        score -= 8;
      }
    }

    if ((source.voice === true) !== (target.voice === true) && source.voice === true) {
      score -= 9;
    }

    if ((source.ageVerified === true) !== (target.ageVerified === true) && source.ageVerified === true) {
      score -= 10;
    }

    const priceDelta = Math.abs(candidate.price - itemData.price) / Math.max(itemData.price, 1);
    score += Math.max(0, 14 - priceDelta * 18);

    const coverage = comparableFields ? matchedFields / comparableFields : 0;
    const blocksExact = (
      ((source.gamepassTotal || 0) >= 700 && (gamepassRatio !== null && gamepassRatio < 0.5))
      || ((source.inventoryPrice || 0) >= 250 && (inventoryRatio !== null && inventoryRatio < 0.45))
      || ((source.incomeTotal || 0) >= 1200 && (incomeRatio !== null && incomeRatio < 0.45))
      || ((source.donationTotal || 0) >= 700 && (donationRatio !== null && donationRatio < 0.45))
      || (totalValueRatio !== null && totalValueRatio < 0.58)
    );

    const blocksClose = (
      ((source.gamepassTotal || 0) >= 700 && (gamepassRatio !== null && gamepassRatio < 0.28))
      || ((source.inventoryPrice || 0) >= 250 && (inventoryRatio !== null && inventoryRatio < 0.25))
      || ((source.incomeTotal || 0) >= 1200 && (incomeRatio !== null && incomeRatio < 0.25))
      || ((source.donationTotal || 0) >= 700 && (donationRatio !== null && donationRatio < 0.22))
      || (totalValueRatio !== null && totalValueRatio < 0.35)
    );

    let tier = 'wide';
    if (coverage >= 0.82 && score >= 96) {
      tier = 'exact';
    } else if (coverage >= 0.66 && score >= 74) {
      tier = 'close';
    } else if (coverage >= 0.5 && score >= 40) {
      tier = 'medium';
    } else if (coverage <= 0) {
      tier = 'none';
    }

    if (tier === 'exact' && blocksExact) {
      tier = 'close';
    }

    if (tier === 'close' && blocksClose) {
      tier = 'medium';
    }

    return {
      score: Math.round(score * 100) / 100,
      matchedGames: matchedFields,
      gameCoverage: coverage,
      tier,
      tierRank: getComparableTierRank(tier)
    };
  }

  function getRiotComparableMetrics(itemData, candidate) {
    const source = itemData.riotInfo || {};
    const target = candidate.riotInfo || {};
    let score = 0;
    let matchedFields = 0;
    let comparableFields = 0;
    let titleMismatchPenalty = false;

    const compareBoolean = (sourceValue, targetValue, weight) => {
      if (typeof sourceValue !== 'boolean' || typeof targetValue !== 'boolean') {
        return;
      }

      comparableFields += 1;
      if (sourceValue === targetValue) {
        matchedFields += 1;
        score += weight;
      }
    };

    const compareString = (sourceValue, targetValue, weight) => {
      const left = cleanText(sourceValue).toLowerCase();
      const right = cleanText(targetValue).toLowerCase();
      if (!left || !right) {
        return;
      }

      comparableFields += 1;
      if (left === right) {
        matchedFields += 1;
        score += weight;
      }
    };

    const compareNumeric = (sourceValue, targetValue, weight, toleranceRatio, floorTolerance) => {
      if (!Number.isFinite(sourceValue) || !Number.isFinite(targetValue)) {
        return;
      }

      comparableFields += 1;
      const delta = Math.abs(sourceValue - targetValue);
      const tolerance = Math.max(floorTolerance, Math.abs(sourceValue) * toleranceRatio);
      if (delta <= tolerance) {
        matchedFields += 1;
        score += weight;
        return;
      }

      const partial = Math.max(0, 1 - delta / Math.max(tolerance * 2, 1));
      score += weight * partial * 0.42;
    };

    compareBoolean(source.emailLinked, target.emailLinked, 8);
    compareBoolean(source.phoneVerified, target.phoneVerified, 7);
    compareString(source.emailDomain, target.emailDomain, 3);

    if (source.mode && target.mode) {
      comparableFields += 1;
      if (source.mode === target.mode) {
        matchedFields += 1;
        score += 12;
      } else {
        score -= 18;
      }
    }

    const sourceCompareTags = source.titleCompareTags || [];
    const targetCompareTags = target.titleCompareTags || [];
    if (sourceCompareTags.length) {
      comparableFields += 1;
      const sourceSet = new Set(sourceCompareTags);
      const targetSet = new Set(targetCompareTags);
      let overlap = 0;
      for (const tag of sourceSet) {
        if (targetSet.has(tag)) {
          overlap += 1;
        }
      }

      if (overlap > 0) {
        const ratio = overlap / sourceSet.size;
        if (ratio >= 0.5) {
          matchedFields += 1;
        }
        score += ratio * 20;
      } else {
        titleMismatchPenalty = true;
        score -= targetCompareTags.length ? 26 : 18;
      }
    }

    if (source.mode === 'valorant' && target.mode === 'valorant') {
      compareString(source.valorant.region, target.valorant.region, 8);
      compareNumeric(source.valorant.inventoryValue, target.valorant.inventoryValue, 18, 0.22, 500);
      compareNumeric(source.valorant.vp, target.valorant.vp, 7, 0.5, 120);
      compareNumeric(source.valorant.rp, target.valorant.rp, 6, 0.5, 100);
      compareNumeric(source.valorant.freeAgents, target.valorant.freeAgents, 5, 0.45, 1);
      compareNumeric(source.valorant.agentCount, target.valorant.agentCount, 9, 0.25, 2);
      compareNumeric(source.valorant.level, target.valorant.level, 10, 0.2, 20);
      compareNumeric(source.valorant.knifeCount, target.valorant.knifeCount, 10, 0.35, 1);
      compareNumeric(source.valorant.skinCount, target.valorant.skinCount, 10, 0.25, 2);
      compareNumeric(source.valorant.currentRankValue, target.valorant.currentRankValue, 12, 0.08, 2);
      compareNumeric(source.valorant.lastRankValue, target.valorant.lastRankValue, 8, 0.1, 2);
      compareString(source.valorant.currentRankText, target.valorant.currentRankText, 4);

      if ((source.valorant.inventoryValue || 0) >= 3000 && (target.valorant.inventoryValue || 0) < source.valorant.inventoryValue * 0.45) {
        score -= 18;
      }
      if ((source.valorant.knifeCount || 0) >= 1 && (target.valorant.knifeCount || 0) <= 0) {
        score -= 14;
      }
      if ((source.valorant.agentCount || 0) >= 5 && (target.valorant.agentCount || 0) < Math.max(1, source.valorant.agentCount * 0.45)) {
        score -= 10;
      }
      if ((source.valorant.level || 0) >= 100 && (target.valorant.level || 0) < source.valorant.level * 0.5) {
        score -= 10;
      }
      if ((source.valorant.lastRankValue || 0) >= 3 && (target.valorant.lastRankValue || 0) <= 0) {
        score -= 18;
      }
      if ((source.valorant.lastRankValue || 0) >= 6 && (target.valorant.lastRankValue || 0) > 0 && (target.valorant.lastRankValue || 0) < source.valorant.lastRankValue - 3) {
        score -= 10;
      }
      if (/ranked ready/i.test(source.valorant.currentRankText || '') && (target.valorant.currentRankValue || 0) <= 0 && (target.valorant.lastRankValue || 0) <= 0) {
        score -= 12;
      }
    }

    if (source.mode === 'lol' && target.mode === 'lol') {
      compareString(source.lol.region, target.lol.region, 10);
      compareString(source.lol.rank, target.lol.rank, 10);
      compareNumeric(source.lol.championCount, target.lol.championCount, 16, 0.18, 6);
      compareNumeric(source.lol.skinCount, target.lol.skinCount, 14, 0.22, 2);
      compareNumeric(source.lol.level, target.lol.level, 10, 0.2, 8);
      compareNumeric(source.lol.blueEssence, target.lol.blueEssence, 6, 0.45, 250);
      compareNumeric(source.lol.orangeEssence, target.lol.orangeEssence, 5, 0.45, 120);
      compareNumeric(source.lol.mythicEssence, target.lol.mythicEssence, 5, 0.5, 10);
      compareNumeric(source.lol.riotPoints, target.lol.riotPoints, 6, 0.45, 120);
      compareNumeric(source.lol.winRate, target.lol.winRate, 4, 0.2, 5);

      if ((source.lol.skinCount || 0) >= 10 && (target.lol.skinCount || 0) < source.lol.skinCount * 0.4) {
        score -= 12;
      }
      if ((source.lol.championCount || 0) >= 40 && (target.lol.championCount || 0) < source.lol.championCount * 0.45) {
        score -= 12;
      }
    }

    const priceDelta = Math.abs(candidate.price - itemData.price) / Math.max(itemData.price, 1);
    score += Math.max(0, 14 - priceDelta * 18);

    const coverage = comparableFields ? matchedFields / comparableFields : 0;
    let tier = 'wide';
    if (coverage >= 0.82 && score >= 88) {
      tier = 'exact';
    } else if (coverage >= 0.64 && score >= 62) {
      tier = 'close';
    } else if (coverage >= 0.45 && score >= 38) {
      tier = 'medium';
    } else if (coverage <= 0) {
      tier = 'none';
    }

    if (titleMismatchPenalty) {
      if (tier === 'exact') {
        tier = 'medium';
      } else if (tier === 'close') {
        tier = 'wide';
      }
    }

    return {
      score: Math.round(score * 100) / 100,
      matchedGames: matchedFields,
      gameCoverage: coverage,
      tier,
      tierRank: getComparableTierRank(tier)
    };
  }

  function extractMinecraftInfoFromApiItem(item) {
    const hasMinecraftFields = Object.prototype.hasOwnProperty.call(item, 'minecraft_java')
      || Object.prototype.hasOwnProperty.call(item, 'minecraft_bedrock')
      || Object.prototype.hasOwnProperty.call(item, 'minecraft_hypixel_level');

    if (!hasMinecraftFields) {
      return null;
    }

    return {
      username: cleanText(item.minecraft_nickname),
      java: parseApiBoolean(item.minecraft_java),
      bedrock: parseApiBoolean(item.minecraft_bedrock),
      dungeons: parseApiBoolean(item.minecraft_dungeons),
      legends: parseApiBoolean(item.minecraft_legends),
      canChangeNickname: parseApiBoolean(item.minecraft_can_change_nickname),
      minecoins: parseFiniteNumber(item.minecraft_minecoins),
      capesCount: parseFiniteNumber(item.minecraft_capes_count),
      hypixelRank: cleanText(item.minecraft_hypixel_rank),
      hypixelLevel: parseFiniteNumber(item.minecraft_hypixel_level),
      hypixelAchievement: parseFiniteNumber(item.minecraft_hypixel_achievement),
      hypixelSkyblockLevel: parseFiniteNumber(item.minecraft_hypixel_skyblock_level),
      hypixelSkyblockNetWorth: parseFiniteNumber(item.minecraft_hypixel_skyblock_net_worth),
      hypixelApi: parseApiBoolean(item.minecraft_hypixel_skyblock_api_enabled),
      hypixelBan: parseHypixelBan(item.minecraft_hypixel_ban),
      emailDomain: cleanText(item.item_domain).toLowerCase()
    };
  }

  function extractFortniteInfoFromApiItem(item) {
    const hasFortniteFields = Object.prototype.hasOwnProperty.call(item, 'fortnite_platform')
      || Object.prototype.hasOwnProperty.call(item, 'fortnite_skin_count')
      || Object.prototype.hasOwnProperty.call(item, 'fortnite_level');

    if (!hasFortniteFields) {
      return null;
    }

    const skins = normalizeFortniteApiCosmetics(item.fortniteSkins);
    const pickaxes = normalizeFortniteApiCosmetics(item.fortnitePickaxe);
    const dances = normalizeFortniteApiCosmetics(item.fortniteDance);
    const gliders = normalizeFortniteApiCosmetics(item.fortniteGliders);

    return {
      linkedAccounts: cleanText(item.fortniteLinkedAccountsString).split(/[,+]/).map((part) => cleanText(part)).filter(Boolean),
      changeEmail: parseApiBoolean(item.fortnite_change_email),
      lastActivityAt: parseFiniteNumber(item.fortnite_last_activity),
      level: parseFiniteNumber(item.fortnite_level),
      balance: parseFiniteNumber(item.fortnite_balance),
      platform: cleanText(item.fortnite_platform),
      lifetimeWins: parseFiniteNumber(item.fortnite_lifetime_wins),
      currentSeason: parseFiniteNumber(item.fortnite_season_num),
      battlePass: parseApiBoolean(item.fortnite_books_purchased),
      bookLevel: parseFiniteNumber(item.fortnite_book_level),
      refundCredits: parseFiniteNumber(item.fortnite_refund_credits),
      friendsCount: parseFiniteNumber(item.fortnite_friends_count),
      registerDate: parseFiniteNumber(item.fortnite_register_date),
      country: cleanText(item.fortnite_country),
      xboxLinkable: parseApiBoolean(item.fortnite_xbox_linkable),
      psnLinkable: parseApiBoolean(item.fortnite_psn_linkable),
      rlPurchases: parseApiBoolean(item.fortnite_rl_purchases),
      emailDomain: cleanText(item.item_domain).toLowerCase(),
      skinCount: parseFiniteNumber(item.fortnite_skin_count) ?? skins.length,
      pickaxeCount: parseFiniteNumber(item.fortnite_pickaxe_count) ?? pickaxes.length,
      danceCount: parseFiniteNumber(item.fortnite_dance_count) ?? dances.length,
      gliderCount: parseFiniteNumber(item.fortnite_glider_count) ?? gliders.length,
      headlineSkins: [],
      featuredSkins: skins.slice(0, 8),
      featuredPickaxes: pickaxes.slice(0, 6),
      featuredDances: dances.slice(0, 6),
      featuredGliders: gliders.slice(0, 6)
    };
  }

  function extractRobloxInfoFromApiItem(item) {
    const hasRobloxFields = Object.prototype.hasOwnProperty.call(item, 'roblox_robux')
      || Object.prototype.hasOwnProperty.call(item, 'roblox_inventory_price')
      || Object.prototype.hasOwnProperty.call(item, 'roblox_voice');

    if (!hasRobloxFields) {
      return null;
    }

    const titleStats = extractRobloxTitleStats(item.title);

    return {
      username: cleanText(item.roblox_username),
      country: normalizeCountryValue(item.roblox_country),
      ageGroup: cleanText(item.roblox_age_group),
      registerDate: parseFiniteNumber(item.roblox_register_date),
      subscriptionAutoRenew: parseApiBoolean(item.roblox_subscription_auto_renew),
      socialLinks: cleanText(item.robloxLinkedAccounts) ? true : false,
      robux: parseFiniteNumber(item.roblox_robux),
      verified: parseApiBoolean(item.roblox_verified),
      ageVerified: parseApiBoolean(item.roblox_age_verified),
      voice: parseApiBoolean(item.roblox_voice),
      emailVerified: parseApiBoolean(item.roblox_email_verified),
      friends: parseFiniteNumber(item.roblox_friends),
      followers: parseFiniteNumber(item.roblox_followers),
      creditBalance: parseFiniteNumber(item.roblox_credit_balance),
      inventoryPrice: parseFiniteNumber(item.roblox_inventory_price) ?? titleStats.inventoryPrice,
      limitedPrice: parseFiniteNumber(item.roblox_limited_price),
      ugcLimitedPrice: parseFiniteNumber(item.roblox_ugc_limited_price),
      gamepassTotal: parseFiniteNumber(item.roblox_game_pass_total_robux) ?? titleStats.gamepassTotal,
      donationTotal: titleStats.donationTotal,
      incomeTotal: parseFiniteNumber(item.roblox_incoming_robux_total) ?? titleStats.incomeTotal,
      offsaleCount: parseFiniteNumber(item.roblox_offsale_count) ?? titleStats.offsaleCount,
      emailDomain: cleanText(item.item_domain).toLowerCase(),
      origin: cleanText(item.resale_item_origin).toLowerCase()
    };
  }

  function extractRiotInfoFromApiItem(item) {
    const hasRiotFields = Object.prototype.hasOwnProperty.call(item, 'riot_id')
      || Object.prototype.hasOwnProperty.call(item, 'riot_valorant_region')
      || Object.prototype.hasOwnProperty.call(item, 'riot_lol_region');

    if (!hasRiotFields) {
      return null;
    }

    const valorantRegion = normalizeRiotRegion(item.riot_valorant_region);
    const lolRegion = normalizeRiotRegion(item.riot_lol_region);
    const valorantInventoryValue = parseFiniteNumber(item.riot_valorant_inventory_value);
    const valorantLevel = parseFiniteNumber(item.riot_valorant_level);
    const valorantSkinCount = parseFiniteNumber(item.riot_valorant_skin_count);
    const lolChampionCount = parseFiniteNumber(item.riot_lol_champion_count);
    const lolSkinCount = parseFiniteNumber(item.riot_lol_skin_count);
    const lolLevel = parseFiniteNumber(item.riot_lol_level);
    const titleData = extractRiotTitleData(item.title);
    const mode = detectRiotMode({
      title: item.title,
      valorantRegion,
      valorantInventoryValue,
      valorantLevel,
      valorantSkinCount,
      lolRegion,
      lolChampionCount,
      lolSkinCount,
      lolLevel
    });

    return {
      mode,
      titleTags: titleData.titleTags,
      titleCompareTags: titleData.titleCompareTags,
      lastActivityAt: parseFiniteNumber(item.riot_last_activity),
      emailLinked: parseApiBoolean(item.riot_email_verified),
      country: normalizeCountryValue(item.riot_country),
      phoneVerified: parseApiBoolean(item.riot_phone_verified),
      emailDomain: cleanText(item.item_domain).toLowerCase(),
      origin: cleanText(item.itemOriginPhrase || item.item_origin || '').toLowerCase(),
      valorant: {
        inventoryValue: valorantInventoryValue,
        vp: parseFiniteNumber(item.riot_valorant_wallet_vp),
        rp: parseFiniteNumber(item.riot_valorant_wallet_rp),
        freeAgents: parseFiniteNumber(item.riot_valorant_wallet_fa),
        agentCount: parseFiniteNumber(item.riot_valorant_agent_count),
        currentRankText: normalizeValorantRankTextFromApi(item.riot_valorant_rank, item.riot_valorant_rank_type),
        currentRankValue: parseFiniteNumber(item.riot_valorant_rank),
        previousRankText: normalizeValorantRankTextFromApi(item.riot_valorant_previous_rank, ''),
        previousRankValue: parseFiniteNumber(item.riot_valorant_previous_rank),
        lastRankText: normalizeValorantRankTextFromApi(item.riot_valorant_last_rank, ''),
        lastRankValue: parseFiniteNumber(item.riot_valorant_last_rank),
        level: valorantLevel,
        knifeCount: parseFiniteNumber(item.riot_valorant_knife_count),
        region: valorantRegion,
        skinCount: valorantSkinCount
      },
      lol: {
        region: lolRegion,
        championCount: lolChampionCount,
        skinCount: lolSkinCount,
        level: lolLevel,
        blueEssence: parseFiniteNumber(item.riot_lol_wallet_blue),
        orangeEssence: parseFiniteNumber(item.riot_lol_wallet_orange),
        mythicEssence: parseFiniteNumber(item.riot_lol_wallet_mythic),
        riotPoints: parseFiniteNumber(item.riot_lol_wallet_riot),
        rank: cleanText(item.riot_lol_rank),
        winRate: parseFiniteNumber(item.riot_lol_rank_win_rate)
      }
    };
  }

  function parseHeadlineGames(title, games) {
    const titleParts = title.split('|').map((part) => cleanText(part)).filter(Boolean);
    const matched = titleParts.map((part) => games.find((entry) => entry.title.toLowerCase() === part.toLowerCase()) || null).filter(Boolean);
    return matched.length ? matched : games.slice(0, 3);
  }

  function resolveFeaturedFortniteSkins(title, skins) {
    if (!skins.length) {
      return [];
    }

    const titleParts = title.split('|')
      .map((part) => cleanText(part))
      .filter(Boolean)
      .filter((part) => !/^\d+\s+skins?$/i.test(part))
      .filter((part) => !/^\d+\s+скин/i.test(part));

    const matched = titleParts
      .map((part) => skins.find((item) => item.title.toLowerCase() === part.toLowerCase()) || null)
      .filter(Boolean);

    return matched.length ? matched.slice(0, 8) : skins.slice(0, 8);
  }

  function normalizeFortniteApiCosmetics(list) {
    if (!Array.isArray(list)) {
      return [];
    }

    return list.map((item) => ({
      id: cleanText(item?.id),
      title: cleanText(item?.title)
    })).filter((item) => item.id && item.title);
  }

  function extractRobloxTitleStats(title) {
    const text = cleanText(title);
    return {
      robux: extractRobloxTitleAmount(text, /(\d[\d\s]*)\s*R\$\s*на\s*балансе/i),
      inventoryPrice: extractRobloxTitleAmount(text, /инвентарь\s*(\d[\d\s]*)\s*R\$/i),
      gamepassTotal: extractRobloxTitleAmount(text, /геймпассы\s*(\d[\d\s]*)\s*R\$/i),
      donationTotal: extractRobloxTitleAmount(text, /донат\s*(\d[\d\s]*)\s*R\$/i),
      incomeTotal: extractRobloxTitleAmount(text, /доход\s*(\d[\d\s]*)\s*R\$/i),
      offsaleCount: extractRobloxTitleAmount(text, /offsale\s*(\d[\d\s]*)/i),
      voice: /войс-?чат|voice\s*chat/i.test(text)
    };
  }

  function extractRobloxTitleAmount(text, pattern) {
    const match = cleanText(text).match(pattern);
    return match ? parseLooseNumber(match[1]) : null;
  }

  function extractRiotTitleData(title) {
    const text = cleanText(title);
    const lower = text.toLowerCase();
    const valorantInventoryValue = extractRiotTitleAmount(text, /~?\s*(\d[\d\s]*)\s*vp/i);
    const valorantAgentCount = extractRiotTitleAmount(text, /(\d[\d\s]*)\s*агент/i);
    const lolChampionCount = extractRiotTitleAmount(text, /(\d[\d\s]*)\s*champions?/i);
    const lolSkinCount = extractRiotTitleAmount(text, /(\d[\d\s]*)\s*skins?/i);
    const lolLevel = extractRiotTitleAmount(text, /lvl\.?\s*(\d[\d\s]*)/i);
    return {
      mode: detectRiotMode({
        title: text,
        valorantRegion: '',
        valorantInventoryValue,
        valorantLevel: null,
        valorantSkinCount: null,
        lolRegion: '',
        lolChampionCount,
        lolSkinCount,
        lolLevel
      }),
      titleTags: text.split('|').map((part) => cleanText(part)).filter(Boolean).slice(0, 6),
      titleCompareTags: extractRiotCompareTags(text),
      valorant: {
        inventoryValue: valorantInventoryValue,
        agentCount: valorantAgentCount
      },
      lol: {
        region: extractRiotTitleRegion(text),
        championCount: lolChampionCount,
        skinCount: lolSkinCount,
        level: lolLevel,
        rank: /unranked|без ранга/i.test(lower) ? 'Unranked' : ''
      }
    };
  }

  function extractRiotTitleAmount(text, pattern) {
    const match = cleanText(text).match(pattern);
    return match ? parseLooseNumber(match[1]) : null;
  }

  function extractRiotTitleRegion(text) {
    const firstPart = cleanText(text).split('|')[0] || '';
    const token = cleanText(firstPart).toUpperCase();
    return /^[A-Z0-9]{2,5}$/.test(token) ? token : '';
  }

  function extractRiotCompareTags(text) {
    return cleanText(text)
      .split('|')
      .map((part) => cleanText(part))
      .filter(Boolean)
      .map((part) => part.replace(/^~?\s*\d[\d\s]*\s*vp$/i, ''))
      .map((part) => part.replace(/^valorant$/i, ''))
      .map((part) => part.replace(/^телефон\s+(не\s+)?привязан$/i, ''))
      .map((part) => part.replace(/^(europe|eu|na|la|ap|kr|br|tr|jp|oce|es|euw1|la1|la2|vn2)$/i, ''))
      .map((part) => part.replace(/^(был\s+)?(iron|bronze|silver|gold|platinum|diamond|ascendant|immortal|radiant)\s*[123ivx]*$/i, ''))
      .map((part) => part.replace(/^\d+\s*агент[а-я]*$/i, ''))
      .map((part) => part.replace(/^lvl\.?\s*\d+$/i, ''))
      .map((part) => part.replace(/^\d+\s*(skins?|champions?)$/i, ''))
      .map((part) => cleanText(part).toLowerCase())
      .filter((part) => part.length >= 3);
  }

  function detectRiotMode(data) {
    const title = cleanText(data.title).toLowerCase();
    const valorantSignals = [
      Number.isFinite(data.valorantInventoryValue) && data.valorantInventoryValue > 0,
      Number.isFinite(data.valorantLevel) && data.valorantLevel > 0,
      Number.isFinite(data.valorantSkinCount) && data.valorantSkinCount > 0,
      Boolean(cleanText(data.valorantRegion)),
      /vp|valorant|vandal|phantom|knife|нож/i.test(title)
    ].filter(Boolean).length;
    const lolSignals = [
      Number.isFinite(data.lolChampionCount) && data.lolChampionCount > 0,
      Number.isFinite(data.lolSkinCount) && data.lolSkinCount > 0,
      Number.isFinite(data.lolLevel) && data.lolLevel > 0,
      Boolean(cleanText(data.lolRegion)),
      /champions?|unranked|league|lol|skins?/i.test(title)
    ].filter(Boolean).length;
    return valorantSignals >= lolSignals ? 'valorant' : 'lol';
  }

  function applyNomatterFilter(params, key, value) {
    if (value === true) {
      params.set(key, 'yes');
      return;
    }

    if (value === false) {
      params.set(key, 'no');
    }
  }

  function buildTitleTerms(title) {
    return title.split('|').map((part) => cleanText(part)).filter((part) => part.length >= 3).slice(0, 2);
  }

  function tokenize(text) {
    return cleanText(text)
      .toLowerCase()
      .replace(/[|()[\],.+:/\\-]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => token.length >= 20);
  }

  function extractGameId(src) {
    const match = src.match(/\/steam\/header\/(\d+)\./);
    return match ? match[1] : null;
  }

  function extractGameIdFromHref(href) {
    const match = href.match(/(?:\/app\/|app\/)(\d+)/i);
    return match ? match[1] : '';
  }

  function looksLikeGameTitle(value) {
    const text = cleanText(value);
    if (!text || text.length < 2 || text.length > 120) {
      return false;
    }

    if (/^\d+([.,]\d+)?\s*(ч|час|min|мин)\.?$/i.test(text)) {
      return false;
    }

    if (/^(актуальные игры|информация обновлена|данные от аккаунта|гарантия|метка)$/i.test(text)) {
      return false;
    }

    return /[a-zа-я0-9]/i.test(text);
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseDateTimeValue(node) {
    const timeValue = Number(node?.querySelector('.DateTime')?.getAttribute('data-time') || node?.querySelector('abbr.DateTime')?.getAttribute('data-time') || 0);
    return Number.isFinite(timeValue) && timeValue > 0 ? timeValue : null;
  }

  function parseYesNoValue(value) {
    const normalized = cleanText(value).toLowerCase();
    if (normalized === 'да') {
      return true;
    }
    if (normalized === 'нет') {
      return false;
    }
    return null;
  }

  function parseMaybeValue(value) {
    const normalized = cleanText(value).toLowerCase();
    if (normalized === 'да') {
      return true;
    }
    if (normalized === 'нет') {
      return false;
    }
    if (normalized === 'может быть') {
      return 'maybe';
    }
    return null;
  }

  function parseLooseNumber(value) {
    const match = String(value || '').replace(/\s+/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function parseFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseApiBoolean(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return Number(value) > 0;
  }

  function parseHypixelBan(value) {
    if (typeof value === 'number') {
      if (value === 0) {
        return 'absent';
      }
      if (value > 0) {
        return 'present';
      }
      return 'unknown';
    }

    const normalized = cleanText(value).toLowerCase();
    if (!normalized) {
      return 'unknown';
    }
    if (normalized === 'отсутствует' || normalized === 'нет') {
      return 'absent';
    }
    return 'present';
  }

  function parseMinecraftNetWorth(value, titleValue = '') {
    const titleNumber = parseLooseNumber(titleValue);
    if (Number.isFinite(titleNumber)) {
      return titleNumber;
    }

    const normalized = cleanText(value).toLowerCase().replace(',', '.');
    const match = normalized.match(/(\d+(\.\d+)?)([kmb])?/i);
    if (!match) {
      return null;
    }

    const base = Number(match[1]);
    const suffix = (match[3] || '').toLowerCase();
    if (suffix === 'k') {
      return Math.round(base * 1000);
    }
    if (suffix === 'm') {
      return Math.round(base * 1000000);
    }
    if (suffix === 'b') {
      return Math.round(base * 1000000000);
    }
    return base;
  }

  function looksLikeCountryCode(value) {
    return /^[A-Z]{2}$/.test(cleanText(value));
  }

  function normalizeCountryValue(value) {
    const normalized = cleanText(value).toUpperCase();
    if (looksLikeCountryCode(normalized)) {
      return normalized;
    }
    return cleanText(value);
  }

  function isRiotCategory(categorySlug) {
    return ['riot', 'valorant', 'lol'].includes(categorySlug);
  }

  function normalizeRiotRegion(value) {
    const normalized = cleanText(value);
    const upper = normalized.toUpperCase();
    const map = {
      'ЛАТИНСКАЯ АМЕРИКА': 'LA',
      'СЕВЕРНАЯ АМЕРИКА': 'NA',
      'ЕВРОПА': 'EU',
      'КОРЕЯ': 'KR',
      'АЗИЯ': 'AP',
      'АЗИЯ-ТИХООКЕАНСКИЙ РЕГИОН': 'AP',
      'ТИХООКЕАНСКИЙ РЕГИОН': 'AP',
      'БРАЗИЛИЯ': 'BR',
      'ТУРЦИЯ': 'TR',
      'ЯПОНИЯ': 'JP',
      'OCEANIA': 'OCE',
      'LATIN AMERICA': 'LA',
      'NORTH AMERICA': 'NA',
      'EUROPE': 'EU',
      'KOREA': 'KR',
      'ASIA': 'AP',
      'BRAZIL': 'BR',
      'TURKEY': 'TR',
      'JAPAN': 'JP'
    };

    if (map[upper]) {
      return map[upper];
    }

    return upper;
  }

  function looksLikeRiotRegionCode(value) {
    return /^[A-Z0-9]{2,5}$/.test(cleanText(value));
  }

  function parseValorantRankValue(value) {
    const normalized = cleanText(value).toLowerCase();
    if (!normalized || /без ранга|unranked/.test(normalized)) {
      return 0;
    }
    if (/ranked ready/.test(normalized)) {
      return 1;
    }

    const tiers = {
      iron: 3,
      bronze: 6,
      silver: 9,
      gold: 12,
      platinum: 15,
      diamond: 18,
      ascendant: 21,
      immortal: 24,
      radiant: 27
    };

    for (const [name, base] of Object.entries(tiers)) {
      if (normalized.includes(name)) {
        const divisionMatch = normalized.match(/([123])/);
        return base + Math.max(0, Number(divisionMatch?.[1] || 1) - 1);
      }
    }

    return null;
  }

  function normalizeValorantRankTextFromApi(rankValue, rankType) {
    const rank = parseFiniteNumber(rankValue);
    const type = cleanText(rankType).toLowerCase();
    if (type === 'ranked_ready') {
      return 'Ranked Ready';
    }
    if (!Number.isFinite(rank) || rank <= 0) {
      return 'Unranked';
    }

    const bands = [
      { min: 3, max: 5, label: 'Iron' },
      { min: 6, max: 8, label: 'Bronze' },
      { min: 9, max: 11, label: 'Silver' },
      { min: 12, max: 14, label: 'Gold' },
      { min: 15, max: 17, label: 'Platinum' },
      { min: 18, max: 20, label: 'Diamond' },
      { min: 21, max: 23, label: 'Ascendant' },
      { min: 24, max: 26, label: 'Immortal' },
      { min: 27, max: 27, label: 'Radiant' }
    ];

    for (const band of bands) {
      if (rank >= band.min && rank <= band.max) {
        if (band.label === 'Radiant') {
          return band.label;
        }
        return `${band.label} ${rank - band.min + 1}`;
      }
    }

    return String(rank);
  }

  function decodeHtmlEntities(value) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
  }

  function formatPrice(value) {
    return `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
  }

  function formatDateTime(value) {
    return new Date(value).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function formatSignedPercent(value) {
    const rounded = Math.round(value);
    return `${rounded > 0 ? '+' : ''}${rounded}%`;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
})();
