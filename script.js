(() => {
  'use strict';

  /* ============================================================
     State
  ============================================================ */
  const state = {
    tracks: new Map(),                 // id -> { id, title, artist, url, duration, colorSeed }
    playlists: [
      { id: 'library', name: 'Библиотека', cover: null, trackIds: [] }
    ],
    viewPlaylistId: 'library',
    playContext: { playlistId: null, order: [], orderPos: -1 },
    shuffle: false,
    repeatMode: 'off',                 // 'off' | 'all' | 'one'
    speed: 1,
    tone: 0,
    volume: 0.8,
    isPlaying: false,
    isSeeking: false,
    pendingCoverDataUrl: null,
    pickerTargetPlaylistId: null,
  };

  const GRADIENTS = [
    ['#8B87F4', '#5A57E8'],
    ['#6FD6C5', '#2FBFA8'],
    ['#F4A2A0', '#E8615A'],
    ['#F6C667', '#E8A02F'],
    ['#7FB8F0', '#3E7FD9'],
    ['#D69EF0', '#A857E8'],
  ];

  /* ============================================================
     DOM refs
  ============================================================ */
  const $ = (sel) => document.querySelector(sel);
  const audio = $('#audio');

  const el = {
    playlistList: $('#playlistList'),
    trackList: $('#trackList'),
    emptyState: $('#emptyState'),
    playlistCover: $('#playlistCover'),
    playlistKind: $('#playlistKind'),
    playlistName: $('#playlistName'),
    playlistCount: $('#playlistCount'),
    addToPlaylistBtn: $('#addToPlaylistBtn'),

    nowCover: $('#nowCover'),
    nowTitle: $('#nowTitle'),
    nowArtist: $('#nowArtist'),
    eqBars: $('#eqBars'),

    shuffleBtn: $('#shuffleBtn'),
    prevBtn: $('#prevBtn'),
    playBtn: $('#playBtn'),
    playIcon: $('#playIcon'),
    nextBtn: $('#nextBtn'),
    repeatBtn: $('#repeatBtn'),

    seekSlider: $('#seekSlider'),
    timeCurrent: $('#timeCurrent'),
    timeTotal: $('#timeTotal'),
    volumeSlider: $('#volumeSlider'),

    settingsBtn: $('#settingsBtn'),
    settingsPopover: $('#settingsPopover'),
    closeSettings: $('#closeSettings'),
    speedSlider: $('#speedSlider'),
    speedValue: $('#speedValue'),
    toneSlider: $('#toneSlider'),
    toneValue: $('#toneValue'),
    resetSoundBtn: $('#resetSoundBtn'),

    fileInput: $('#fileInput'),
    addTracksBtn: $('#addTracksBtn'),
    emptyAddBtn: $('#emptyAddBtn'),

    newPlaylistBtn: $('#newPlaylistBtn'),
    playlistModalOverlay: $('#playlistModalOverlay'),
    coverPicker: $('#coverPicker'),
    coverInput: $('#coverInput'),
    coverPreview: $('#coverPreview'),
    coverPickerPlaceholder: $('#coverPickerPlaceholder'),
    playlistNameInput: $('#playlistNameInput'),
    createPlaylistBtn: $('#createPlaylistBtn'),
    cancelPlaylistBtn: $('#cancelPlaylistBtn'),

    pickerModalOverlay: $('#pickerModalOverlay'),
    pickerTitle: $('#pickerTitle'),
    pickerList: $('#pickerList'),
    cancelPickerBtn: $('#cancelPickerBtn'),
  };

  /* ============================================================
     Helpers
  ============================================================ */
  const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  function gradientFor(seed) {
    const g = GRADIENTS[hashString(seed) % GRADIENTS.length];
    return `linear-gradient(150deg, ${g[0]}, ${g[1]})`;
  }

  function shuffleArray(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function getPlaylist(id) { return state.playlists.find(p => p.id === id) || null; }
  function getViewPlaylist() { return getPlaylist(state.viewPlaylistId); }
  function getCurrentTrackId() {
    const { order, orderPos } = state.playContext;
    return orderPos >= 0 && orderPos < order.length ? order[orderPos] : null;
  }
  function getCurrentTrack() {
    const id = getCurrentTrackId();
    return id ? state.tracks.get(id) : null;
  }

  function parseNameFromFile(filename) {
    const base = filename.replace(/\.[^/.]+$/, '');
    const parts = base.split(' - ');
    if (parts.length >= 2) {
      return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
    }
    return { artist: 'Неизвестный артист', title: base.trim() };
  }

  /* ============================================================
     Audio graph (Web Audio API) — speed & tone control
  ============================================================ */
  let audioCtx = null, sourceNode = null, lowShelf = null, highShelf = null, graphReady = false;

  function ensureAudioGraph() {
    if (graphReady) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return;
    }
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sourceNode = audioCtx.createMediaElementSource(audio);
      lowShelf = audioCtx.createBiquadFilter();
      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = 320;
      highShelf = audioCtx.createBiquadFilter();
      highShelf.type = 'highshelf';
      highShelf.frequency.value = 3200;
      sourceNode.connect(lowShelf);
      lowShelf.connect(highShelf);
      highShelf.connect(audioCtx.destination);
      applyTone();
      graphReady = true;
    } catch (err) {
      console.warn('Web Audio API недоступен, тон не будет применяться', err);
    }
  }

  function applyTone() {
    if (!graphReady) return;
    lowShelf.gain.value = -state.tone * 12;
    highShelf.gain.value = state.tone * 12;
  }

  /* ============================================================
     Rendering: sidebar (playlists)
  ============================================================ */
  function renderPlaylists() {
    el.playlistList.innerHTML = '';
    state.playlists.forEach((pl) => {
      const li = document.createElement('li');
      li.className = 'playlist-item' + (pl.id === state.viewPlaylistId ? ' active' : '');
      li.addEventListener('click', () => selectPlaylist(pl.id));

      const thumb = document.createElement('div');
      thumb.className = 'playlist-thumb';
      if (pl.cover) thumb.style.backgroundImage = `url(${pl.cover})`;
      else thumb.style.background = gradientFor(pl.id);

      const textWrap = document.createElement('div');
      textWrap.className = 'playlist-item-text';
      const name = document.createElement('div');
      name.className = 'playlist-item-name';
      name.textContent = pl.name;
      const count = document.createElement('div');
      count.className = 'playlist-item-count';
      count.textContent = trackCountLabel(pl.trackIds.length);
      textWrap.append(name, count);

      li.append(thumb, textWrap);
      el.playlistList.appendChild(li);
    });
  }

  function trackCountLabel(n) {
    if (n === 0) return 'Пусто';
    if (n === 1) return '1 трек';
    if (n >= 2 && n <= 4) return `${n} трека`;
    return `${n} треков`;
  }

  function selectPlaylist(id) {
    state.viewPlaylistId = id;
    renderPlaylists();
    renderTrackList();
    renderPlaylistHeader();
  }

  function renderPlaylistHeader() {
    const pl = getViewPlaylist();
    if (!pl) return;
    el.playlistKind.textContent = pl.id === 'library' ? 'Ваша библиотека' : 'Плейлист';
    el.playlistName.textContent = pl.name;
    el.playlistCount.textContent = trackCountLabel(pl.trackIds.length);
    if (pl.cover) {
      el.playlistCover.style.backgroundImage = `url(${pl.cover})`;
      el.playlistCover.style.background = '';
      el.playlistCover.style.backgroundImage = `url(${pl.cover})`;
    } else {
      el.playlistCover.style.backgroundImage = '';
      el.playlistCover.style.background = gradientFor(pl.id);
    }
    el.addToPlaylistBtn.querySelector('span').textContent =
      pl.id === 'library' ? 'Добавить музыку' : 'Добавить трек';
  }

  /* ============================================================
     Rendering: track list
  ============================================================ */
  function renderTrackList() {
    const pl = getViewPlaylist();
    el.trackList.innerHTML = '';
    if (!pl || pl.trackIds.length === 0) {
      el.trackList.appendChild(el.emptyState);
      return;
    }
    const currentId = getCurrentTrackId();
    pl.trackIds.forEach((trackId, idx) => {
      const track = state.tracks.get(trackId);
      if (!track) return;
      const row = document.createElement('div');
      row.className = 'track-row' + (trackId === currentId ? ' playing' : '');
      row.addEventListener('click', (e) => {
        if (e.target.closest('.track-remove')) return;
        playTrackFromList(trackId, pl.id);
      });

      const index = document.createElement('div');
      index.className = 'track-index';
      index.textContent = trackId === currentId && state.isPlaying ? '♪' : String(idx + 1);

      const thumb = document.createElement('div');
      thumb.className = 'track-thumb';
      thumb.style.background = gradientFor(track.id);

      const info = document.createElement('div');
      info.className = 'track-info';
      const title = document.createElement('div');
      title.className = 'track-title';
      title.textContent = track.title;
      const artist = document.createElement('div');
      artist.className = 'track-artist';
      artist.textContent = track.artist;
      info.append(title, artist);

      const duration = document.createElement('div');
      duration.className = 'track-duration';
      duration.textContent = track.duration ? formatTime(track.duration) : '';

      const remove = document.createElement('button');
      remove.className = 'icon-btn track-remove';
      remove.title = pl.id === 'library' ? 'Удалить из библиотеки' : 'Убрать из плейлиста';
      remove.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      remove.addEventListener('click', (e) => {
        e.stopPropagation();
        removeTrackFromPlaylist(trackId, pl.id);
      });

      row.append(index, thumb, info, duration, remove);
      el.trackList.appendChild(row);
    });
  }

  /* ============================================================
     Playback engine
  ============================================================ */
  function playTrackFromList(trackId, fromPlaylistId) {
    const pl = getPlaylist(fromPlaylistId);
    if (!pl) return;
    let order;
    if (state.shuffle) {
      const rest = pl.trackIds.filter((id) => id !== trackId);
      order = [trackId, ...shuffleArray(rest)];
    } else {
      order = pl.trackIds.slice();
    }
    state.playContext = { playlistId: fromPlaylistId, order, orderPos: order.indexOf(trackId) };
    loadTrackAtOrderPos(state.playContext.orderPos, true);
  }

  function loadTrackAtOrderPos(pos, autoplay) {
    const { order } = state.playContext;
    if (pos < 0 || pos >= order.length) return;
    state.playContext.orderPos = pos;
    const track = state.tracks.get(order[pos]);
    if (!track) return;

    audio.src = track.url;
    audio.playbackRate = state.speed;

    updateNowPlayingUI(track);
    renderTrackList();

    if (autoplay) play();
    else renderTransportUI();
  }

  function play() {
    if (!getCurrentTrack()) {
      const pl = getViewPlaylist();
      if (pl && pl.trackIds.length) {
        playTrackFromList(pl.trackIds[0], pl.id);
      }
      return;
    }
    ensureAudioGraph();
    const p = audio.play();
    if (p && p.catch) p.catch((err) => console.warn('Воспроизведение не удалось', err));
    state.isPlaying = true;
    renderTransportUI();
    renderTrackList();
  }

  function pause() {
    audio.pause();
    state.isPlaying = false;
    renderTransportUI();
    renderTrackList();
  }

  function togglePlay() {
    if (state.isPlaying) pause();
    else play();
  }

  function stepTrack(direction) {
    const { order, orderPos } = state.playContext;
    if (!order.length) return;
    const next = (orderPos + direction + order.length) % order.length;
    loadTrackAtOrderPos(next, true);
  }

  function handleEnded() {
    if (state.repeatMode === 'one') {
      audio.currentTime = 0;
      play();
      return;
    }
    const { order, orderPos } = state.playContext;
    const isLast = orderPos === order.length - 1;
    if (isLast && state.repeatMode === 'off') {
      pause();
      audio.currentTime = 0;
      return;
    }
    stepTrack(1);
  }

  /* ============================================================
     UI updates: now playing / transport / seek
  ============================================================ */
  function updateNowPlayingUI(track) {
    el.nowTitle.textContent = track.title;
    el.nowArtist.textContent = track.artist;
    el.nowCover.style.background = gradientFor(track.id);
    document.title = `${track.title} · ${track.artist} — any music`;
  }

  function renderTransportUI() {
    el.playBtn.classList.toggle('is-playing', state.isPlaying);
    el.playIcon.innerHTML = state.isPlaying
      ? '<path d="M7 4h4v16H7zM13 4h4v16h-4z" fill="currentColor"/>'
      : '<path d="M7 4l13 8-13 8V4z" fill="currentColor"/>';
    el.playBtn.title = state.isPlaying ? 'Пауза' : 'Играть';
    el.eqBars.classList.toggle('playing', state.isPlaying);
    el.shuffleBtn.classList.toggle('active', state.shuffle);
    el.repeatBtn.classList.toggle('active', state.repeatMode !== 'off');
    el.repeatBtn.classList.toggle('repeat-one', state.repeatMode === 'one');
    el.repeatBtn.title = {
      off: 'Повтор: выключен',
      all: 'Повтор: весь плейлист',
      one: 'Повтор: один трек',
    }[state.repeatMode];
  }

  function updateSeekUI() {
    if (state.isSeeking) return;
    const dur = audio.duration || 0;
    const cur = audio.currentTime || 0;
    el.seekSlider.value = dur ? String(Math.round((cur / dur) * 1000)) : '0';
    el.timeCurrent.textContent = formatTime(cur);
    el.timeTotal.textContent = formatTime(dur);
  }

  /* ============================================================
     Track / playlist mutation
  ============================================================ */
  function addTracksFromFiles(fileList, targetPlaylistId) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(f.name));
    if (!files.length) return;

    files.forEach((file) => {
      const id = uid();
      const url = URL.createObjectURL(file);
      const guess = parseNameFromFile(file.name);
      const track = { id, title: guess.title, artist: guess.artist, url, duration: 0 };
      state.tracks.set(id, track);

      const library = getPlaylist('library');
      library.trackIds.push(id);
      if (targetPlaylistId && targetPlaylistId !== 'library') {
        const target = getPlaylist(targetPlaylistId);
        if (target && !target.trackIds.includes(id)) target.trackIds.push(id);
      }

      // Probe duration quickly using a throwaway audio element.
      const probe = new Audio();
      probe.preload = 'metadata';
      probe.src = url;
      probe.addEventListener('loadedmetadata', () => {
        track.duration = probe.duration;
        renderTrackList();
      }, { once: true });

      // Best-effort ID3 tag read for accurate artist/title.
      if (window.jsmediatags) {
        window.jsmediatags.read(file, {
          onSuccess: (tag) => {
            const t = tag.tags || {};
            if (t.title) track.title = t.title;
            if (t.artist) track.artist = t.artist;
            renderTrackList();
            renderPlaylistHeader();
            if (getCurrentTrackId() === id) updateNowPlayingUI(track);
          },
          onError: () => { /* keep filename-based guess */ },
        });
      }
    });

    renderPlaylists();
    renderTrackList();
    renderPlaylistHeader();
  }

  function removeTrackFromPlaylist(trackId, playlistId) {
    if (playlistId === 'library') {
      // Remove entirely: from every playlist + release the object URL.
      state.playlists.forEach((pl) => {
        const i = pl.trackIds.indexOf(trackId);
        if (i !== -1) pl.trackIds.splice(i, 1);
      });
      const track = state.tracks.get(trackId);
      if (track) URL.revokeObjectURL(track.url);
      state.tracks.delete(trackId);
    } else {
      const pl = getPlaylist(playlistId);
      const i = pl.trackIds.indexOf(trackId);
      if (i !== -1) pl.trackIds.splice(i, 1);
    }

    // Keep playback context consistent if the removed track was queued.
    if (state.playContext.order.includes(trackId)) {
      const wasCurrent = getCurrentTrackId() === trackId;
      const i = state.playContext.order.indexOf(trackId);
      state.playContext.order.splice(i, 1);
      if (i < state.playContext.orderPos) state.playContext.orderPos -= 1;
      if (wasCurrent) {
        if (state.playContext.order.length) {
          loadTrackAtOrderPos(Math.min(state.playContext.orderPos, state.playContext.order.length - 1), state.isPlaying);
        } else {
          pause();
          audio.removeAttribute('src');
          el.nowTitle.textContent = 'Ничего не играет';
          el.nowArtist.textContent = 'Выберите трек';
          el.nowCover.style.background = '';
          state.playContext = { playlistId: null, order: [], orderPos: -1 };
        }
      }
    }

    renderPlaylists();
    renderTrackList();
    renderPlaylistHeader();
  }

  function createPlaylist(name, coverDataUrl) {
    const pl = { id: uid(), name: name || 'Новый плейлист', cover: coverDataUrl || null, trackIds: [] };
    state.playlists.push(pl);
    renderPlaylists();
    selectPlaylist(pl.id);
  }

  /* ============================================================
     Picker modal (add existing library tracks to a playlist)
  ============================================================ */
  function openPicker(playlistId) {
    state.pickerTargetPlaylistId = playlistId;
    const pl = getPlaylist(playlistId);
    el.pickerTitle.textContent = `Добавить треки в «${pl.name}»`;
    renderPickerList();
    el.pickerModalOverlay.classList.add('open');
  }

  function renderPickerList() {
    const pl = getPlaylist(state.pickerTargetPlaylistId);
    const library = getPlaylist('library');
    el.pickerList.innerHTML = '';

    if (!library.trackIds.length) {
      const li = document.createElement('li');
      li.className = 'picker-row';
      li.style.cursor = 'default';
      li.textContent = 'В библиотеке пока нет треков — добавьте музыку с устройства.';
      el.pickerList.appendChild(li);
      return;
    }

    library.trackIds.forEach((trackId) => {
      const track = state.tracks.get(trackId);
      if (!track) return;
      const added = pl.trackIds.includes(trackId);

      const li = document.createElement('li');
      li.className = 'picker-row' + (added ? ' added' : '');

      const check = document.createElement('div');
      check.className = 'picker-check';
      check.innerHTML = added ? '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M4 12l5 5 11-11" stroke="currentColor" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>' : '';

      const thumb = document.createElement('div');
      thumb.className = 'picker-thumb';
      thumb.style.background = gradientFor(track.id);

      const text = document.createElement('div');
      text.className = 'picker-text';
      const title = document.createElement('div');
      title.className = 'picker-title';
      title.textContent = track.title;
      const artist = document.createElement('div');
      artist.className = 'picker-artist';
      artist.textContent = track.artist;
      text.append(title, artist);

      li.append(check, thumb, text);
      li.addEventListener('click', () => {
        const idx = pl.trackIds.indexOf(trackId);
        if (idx === -1) pl.trackIds.push(trackId);
        else pl.trackIds.splice(idx, 1);
        renderPickerList();
        renderPlaylists();
        if (state.viewPlaylistId === pl.id) { renderTrackList(); renderPlaylistHeader(); }
      });
      el.pickerList.appendChild(li);
    });
  }

  /* ============================================================
     Event wiring
  ============================================================ */
  el.addTracksBtn.addEventListener('click', () => el.fileInput.click());
  el.emptyAddBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', (e) => {
    addTracksFromFiles(e.target.files, null);
    e.target.value = '';
  });

  el.addToPlaylistBtn.addEventListener('click', () => {
    const pl = getViewPlaylist();
    if (pl.id === 'library') el.fileInput.click();
    else openPicker(pl.id);
  });

  el.playBtn.addEventListener('click', togglePlay);
  el.nextBtn.addEventListener('click', () => stepTrack(1));
  el.prevBtn.addEventListener('click', () => stepTrack(-1));

  el.shuffleBtn.addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    const { playlistId, order, orderPos } = state.playContext;
    if (playlistId) {
      const currentId = order[orderPos] ?? null;
      const pl = getPlaylist(playlistId);
      let newOrder;
      if (state.shuffle) {
        const rest = pl.trackIds.filter((id) => id !== currentId);
        newOrder = currentId ? [currentId, ...shuffleArray(rest)] : shuffleArray(pl.trackIds);
      } else {
        newOrder = pl.trackIds.slice();
      }
      state.playContext.order = newOrder;
      state.playContext.orderPos = currentId ? newOrder.indexOf(currentId) : -1;
    }
    renderTransportUI();
  });

  el.repeatBtn.addEventListener('click', () => {
    state.repeatMode = { off: 'all', all: 'one', one: 'off' }[state.repeatMode];
    renderTransportUI();
  });

  el.seekSlider.addEventListener('input', () => {
    state.isSeeking = true;
    const dur = audio.duration || 0;
    el.timeCurrent.textContent = formatTime((el.seekSlider.value / 1000) * dur);
  });
  el.seekSlider.addEventListener('change', () => {
    const dur = audio.duration || 0;
    audio.currentTime = (el.seekSlider.value / 1000) * dur;
    state.isSeeking = false;
  });

  el.volumeSlider.addEventListener('input', () => {
    state.volume = el.volumeSlider.value / 100;
    audio.volume = state.volume;
  });

  audio.addEventListener('timeupdate', updateSeekUI);
  audio.addEventListener('loadedmetadata', updateSeekUI);
  audio.addEventListener('ended', handleEnded);
  audio.volume = state.volume;

  /* ---- settings popover ---- */
  el.settingsBtn.addEventListener('click', () => el.settingsPopover.classList.toggle('open'));
  el.closeSettings.addEventListener('click', () => el.settingsPopover.classList.remove('open'));
  document.addEventListener('click', (e) => {
    if (!el.settingsPopover.classList.contains('open')) return;
    if (el.settingsPopover.contains(e.target) || el.settingsBtn.contains(e.target)) return;
    el.settingsPopover.classList.remove('open');
  });

  el.speedSlider.addEventListener('input', () => {
    state.speed = parseFloat(el.speedSlider.value);
    audio.playbackRate = state.speed;
    el.speedValue.textContent = `${state.speed.toFixed(2)}×`;
  });
  el.toneSlider.addEventListener('input', () => {
    state.tone = parseFloat(el.toneSlider.value);
    ensureAudioGraph();
    applyTone();
    el.toneValue.textContent = state.tone.toFixed(2);
  });
  el.resetSoundBtn.addEventListener('click', () => {
    state.speed = 1; state.tone = 0;
    el.speedSlider.value = '1'; el.toneSlider.value = '0';
    el.speedValue.textContent = '1.00×'; el.toneValue.textContent = '0.00';
    audio.playbackRate = 1;
    applyTone();
  });

  /* ---- new playlist modal ---- */
  el.newPlaylistBtn.addEventListener('click', () => {
    state.pendingCoverDataUrl = null;
    el.playlistNameInput.value = '';
    el.coverPreview.hidden = true;
    el.coverPickerPlaceholder.hidden = false;
    el.playlistModalOverlay.classList.add('open');
    el.playlistNameInput.focus();
  });
  el.cancelPlaylistBtn.addEventListener('click', () => el.playlistModalOverlay.classList.remove('open'));
  el.playlistModalOverlay.addEventListener('click', (e) => {
    if (e.target === el.playlistModalOverlay) el.playlistModalOverlay.classList.remove('open');
  });
  el.coverPicker.addEventListener('click', () => el.coverInput.click());
  el.coverInput.addEventListener('change', () => {
    const file = el.coverInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.pendingCoverDataUrl = reader.result;
      el.coverPreview.src = reader.result;
      el.coverPreview.hidden = false;
      el.coverPickerPlaceholder.hidden = true;
    };
    reader.readAsDataURL(file);
  });
  el.createPlaylistBtn.addEventListener('click', () => {
    const name = el.playlistNameInput.value.trim();
    createPlaylist(name || 'Новый плейлист', state.pendingCoverDataUrl);
    el.playlistModalOverlay.classList.remove('open');
  });
  el.playlistNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.createPlaylistBtn.click();
  });

  /* ---- picker modal ---- */
  el.cancelPickerBtn.addEventListener('click', () => el.pickerModalOverlay.classList.remove('open'));
  el.pickerModalOverlay.addEventListener('click', (e) => {
    if (e.target === el.pickerModalOverlay) el.pickerModalOverlay.classList.remove('open');
  });

  /* ---- keyboard shortcuts ---- */
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.code === 'ArrowRight' && e.shiftKey) stepTrack(1);
    else if (e.code === 'ArrowLeft' && e.shiftKey) stepTrack(-1);
  });

  /* ============================================================
     Init
  ============================================================ */
  renderPlaylists();
  renderTrackList();
  renderPlaylistHeader();
  renderTransportUI();
  el.volumeSlider.value = String(Math.round(state.volume * 10110));
})();