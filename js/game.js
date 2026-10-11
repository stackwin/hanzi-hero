/* 小熊识字乐园 - 游戏主逻辑（纯鼠标操作） */
(function () {
  'use strict';

  /* ============ 存档 ============ */
  var KEY = 'kids-shizi-v1';
  var state = {
    stars: 0,
    mastery: {},      // { '一': 3 } 答对次数
    wrong: {},        // { '一': 2 } 答错次数（答对时自然衰减）
    cleared: {},      // { '1': ['learn','find'] } 每关已完成的玩法
    unlockAll: false,
    sound: true,
    name: '远宝',     // 孩子小名（家长可在家长面板修改）
    voiceURI: null,   // 家长选定的系统语音（云音频没覆盖到时才用）
    cloudVoice: 'xiaoxiao', // 朗读声音：'xiaoxiao' | 'xiaoyi' | 'system'
    custom: []        // 家长自定义的字 [{c,p,e,w:[...]}]
  };

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var s = JSON.parse(raw);
        state.stars = s.stars || 0;
        state.mastery = s.mastery || {};
        state.wrong = s.wrong || {};
        state.cleared = s.cleared || {};
        state.unlockAll = !!s.unlockAll;
        state.sound = s.sound !== false;
        state.name = (typeof s.name === 'string') ? s.name : '远宝';
        state.voiceURI = s.voiceURI || null;
        // 老存档没有 cloudVoice，默认给最好听的云朵姐姐
        state.cloudVoice = s.cloudVoice || 'xiaoxiao';
        state.custom = Array.isArray(s.custom) ? s.custom : [];
      }
    } catch (e) { /* 第一次玩，或浏览器不允许存储 */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function storageOK() {
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; } catch (e) { return false; }
  }

  /* ============ 通用工具 ============ */
  var $ = function (id) { return document.getElementById(id); };
  var PRAISE = window.PRAISE, CHEER = window.CHEER, BANK = window.WORD_BANK, A = window.GameAudio;

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pick(arr, n) { return shuffle(arr).slice(0, n); }
  function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* 错题加权：让反复错的字出现更频繁，答对后再自然降权
   *  - 从没学过（mastery=0）        基础 +3（陌生字要先混个脸熟）
   *  - 错一次 +4 权重
   *  - 反复错且掌握度低（错≥2 且 mastery<2）再 +5（最该重点关照的字）
   */
  function weight(c) {
    var wrong = state.wrong[c.c] || 0;
    var m = state.mastery[c.c] || 0;
    var w = 1;
    if (m === 0) w += 3;
    w += wrong * 4;
    if (wrong >= 2 && m < 2) w += 5;
    return w;
  }
  function pickOneWeighted(arr) {
    if (!arr.length) return null;
    var total = 0;
    for (var i = 0; i < arr.length; i++) total += weight(arr[i]);
    if (total <= 0) return arr[Math.random() * arr.length | 0];
    var r = Math.random() * total;
    for (var j = 0; j < arr.length; j++) {
      r -= weight(arr[j]);
      if (r <= 0) return arr[j];
    }
    return arr[arr.length - 1];
  }
  function pickWeighted(arr, n) {
    if (!arr.length) return [];
    var pool = arr.slice();
    var out = [];
    while (out.length < n && pool.length) {
      var picked = pickOneWeighted(pool);
      out.push(picked);
      pool = pool.filter(function (x) { return x.c !== picked.c; });
    }
    return out;
  }

  /* 读一句话。text 可以是字符串，也可以是数组（依次连读，比如 字 → 组词）
   * 第二参数可传数字（语速，仅对系统语音生效）或 { done: 回调 } */
  function speak(text, opts) {
    if (!state.sound) return;
    var o = (typeof opts === 'number') ? { rate: opts } : (opts || {});
    A.speak(text, o);
  }
  /* 试听用的句子：带上孩子名字，家长一听就知道效果 */
  function trySentence() {
    var n = kidName();
    return n ? [n, '你好，我们一起认字吧'] : ['你好，我们一起认字吧'];
  }
  function sfx(fn) { if (state.sound) fn(); }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }

  /* 撒星星特效 */
  function burst(x, y, emoji) {
    var layer = $('fxLayer');
    var chars = emoji || ['⭐', '🌟', '✨', '🎈', '💛', '🍬'];
    for (var i = 0; i < 14; i++) {
      var d = document.createElement('div');
      d.className = 'fx-particle';
      d.textContent = pickOne(chars);
      var ang = Math.random() * Math.PI * 2;
      var dist = 60 + Math.random() * 140;
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      d.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(0) + 'px');
      d.style.setProperty('--dy', (Math.sin(ang) * dist - 40).toFixed(0) + 'px');
      d.style.setProperty('--rot', (Math.random() * 720 - 360).toFixed(0) + 'deg');
      d.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
      layer.appendChild(d);
      (function (el) { setTimeout(function () { el.remove(); }, 1400); })(d);
    }
  }
  function bubble(text) {
    var layer = $('fxLayer');
    var b = document.createElement('div');
    b.className = 'fx-bubble';
    b.textContent = text;
    b.style.left = '50%';
    b.style.top = '38%';
    b.style.transform = 'translateX(-50%)';
    layer.appendChild(b);
    setTimeout(function () { b.remove(); }, 1100);
  }

  function addStar(n) {
    state.stars += n;
    save();
    var el = $('starCount');
    el.textContent = state.stars;
    try {
      el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)' }, { transform: 'scale(1)' }], 320);
    } catch (e) { /* 老浏览器忽略动画 */ }
  }
  function markLearned(ch, n) {
    state.mastery[ch] = (state.mastery[ch] || 0) + (n || 1);
    // 答对时让错次数自然衰减（会忘的字不该马上从错题库消失）
    if (state.wrong[ch]) {
      state.wrong[ch] = Math.max(0, state.wrong[ch] - 0.5);
      if (!state.wrong[ch]) delete state.wrong[ch];
    }
    save();
  }
  function markWrong(ch) {
    if (!ch) return;
    state.wrong[ch] = (state.wrong[ch] || 0) + 1;
    save();
  }
  function knows(ch) { return (state.mastery[ch] || 0) >= 1; }
  function mastered(ch) { return (state.mastery[ch] || 0) >= 3; }

  function kidName() { return (state.name || '').trim(); }
  function applyName() {
    var n = kidName();
    $('logoName').textContent = n ? n + '的识字乐园' : '小熊识字乐园';
    $('homeTitle').textContent = n ? n + '，选一个小关卡吧！' : '选一个小关卡吧！';
  }

  /* 把家长自定义的字作为额外一关 push 进 BANK（动态修改原数组） */
  function syncBank() {
    for (var i = BANK.length - 1; i >= 0; i--) {
      if (BANK[i].id === 'custom') BANK.splice(i, 1);
    }
    if (state.custom && state.custom.length) {
      BANK.push({
        id: 'custom',
        name: '我自己的字',
        icon: '✏️',
        theme: '#FF9F68',
        chars: state.custom
      });
    }
  }

  /* 解析家长输入的字表文本
   * 每行一个字，格式："字 拼音 词语1 词语2"（拼音可选，词默认 1 个）
   * 拼音留空时从内置字库查，emoji 用内置库的，否则默认 🧩 */
  function parseCustom(text) {
    var out = [];
    var lines = (text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var parts = line.split(/[\s,，、;；]+/).filter(Boolean);
      if (!parts.length) continue;
      var c = parts[0].charAt(0);
      var p = '', words = [];
      if (parts.length === 1 && parts[0].length > 1) {
        // 写成"猫māo" 这种紧凑格式
        p = parts[0].slice(1);
      } else {
        p = parts[1] || '';
        words = parts.slice(2);
      }
      // 从内置字库找拼音/emoji/词
      var hit = null;
      for (var b = 0; b < window.WORD_BANK.length && !hit; b++) {
        for (var k = 0; k < window.WORD_BANK[b].chars.length && !hit; k++) {
          if (window.WORD_BANK[b].chars[k].c === c) hit = window.WORD_BANK[b].chars[k];
        }
      }
      if (!p && hit) p = hit.p;
      if (!words.length) words = hit ? hit.w.slice(0, 2) : [c];
      out.push({ c: c, p: p, e: (hit && hit.e) || '🧩', w: words.slice(0, 2) });
    }
    return out;
  }

  /* ============ 屏幕切换 ============ */
  var SCREENS = ['screenHome', 'screenLevel', 'screenGame', 'screenResult', 'screenParent'];
  function showScreen(id) {
    SCREENS.forEach(function (s) { $(s).classList.toggle('hidden', s !== id); });
    window.scrollTo(0, 0);
  }

  /* ============ 首页 ============ */
  function maxUnlocked() {
    if (state.unlockAll) return BANK.length;
    var n = 1;
    for (var i = 0; i < BANK.length; i++) {
      var lv = BANK[i];
      var done = (state.cleared[lv.id] || []).length;
      if (done > 0) n = Math.max(n, i + 2);
      // 家长自定义的关卡永远立即可玩
      if (lv.id === 'custom') n = Math.max(n, i + 1);
    }
    return Math.min(n, BANK.length);
  }

  function renderHome() {
    var unlocked = maxUnlocked();
    var grid = $('levelGrid');
    grid.innerHTML = '';
    BANK.forEach(function (lv, i) {
      var locked = (i + 1) > unlocked;
      var cleared = (state.cleared[lv.id] || []).length;
      var known = lv.chars.filter(function (c) { return knows(c.c); }).length;
      var pct = Math.round(known / lv.chars.length * 100);
      var card = document.createElement('div');
      card.className = 'level-card' + (locked ? ' locked' : '');
      card.innerHTML =
        (cleared >= 1 ? '<span class="lv-done">✅</span>' : '') +
        '<span class="lv-icon">' + lv.icon + '</span>' +
        '<div class="lv-no">第 ' + (i + 1) + ' 关</div>' +
        '<div class="lv-name">' + lv.name + '</div>' +
        '<div class="lv-bar"><i style="width:' + pct + '%;background:' + lv.theme + '"></i></div>' +
        '<div class="lv-prog">认识 ' + known + '/' + lv.chars.length + ' 个字</div>';
      if (!locked) {
        card.onclick = function () { sfx(A.click); openLevel(i); };
      }
      grid.appendChild(card);
    });
    $('starCount').textContent = state.stars;
    showScreen('screenHome');
  }

  /* ============ 关卡页 ============ */
  var curLevel = 0, curMode = null;

  function openLevel(idx) {
    curLevel = idx;
    var lv = BANK[idx];
    $('levelTitle').textContent = lv.icon + ' 第' + (idx + 1) + '关 · ' + lv.name;
    var strip = $('charStrip');
    strip.innerHTML = '';
    lv.chars.forEach(function (ch) {
      var d = document.createElement('div');
      d.className = 'chip' + (knows(ch.c) ? ' known' : '');
      d.innerHTML = '<span class="c">' + ch.c + '</span><span class="p">' + ch.p + '</span>';
      d.onclick = function () {
        sfx(A.click);
        speak([ch.c, ch.w[0]]);   // 念字 → 念组词，自动衔接
      };
      strip.appendChild(d);
    });
    showScreen('screenLevel');
  }

  /* ============ 游戏：公共 ============ */
  var session = null; // { mode, list, idx, right, wrong, star }

  function startMode(mode) {
    curMode = mode;
    session = { mode: mode, idx: 0, right: 0, wrong: 0, star: 0, done: false };
    $('sessionStar').textContent = '0';
    showScreen('screenGame');
    if (mode === 'learn') startLearn();
    else if (mode === 'listen') startListen();
    else if (mode === 'find') startFind();
    else if (mode === 'match') startMatch();
    else if (mode === 'picture') startPicture();
  }

  function setProgress(cur, total) {
    var pct = total ? Math.round(cur / total * 100) : 0;
    $('progFill').style.width = pct + '%';
    $('progText').textContent = cur + '/' + total;
  }
  function updateProgress() {
    if (!session) return;
    if (session.mode === 'learn') setProgress(Math.min(session.idx + 1, session.total), session.total);
    else if (session.mode === 'listen') setProgress(session.idx, session.total);
    else if (session.mode === 'find') setProgress(session.round, session.totalRounds);
    else if (session.mode === 'match') setProgress(session.pairs, session.totalPairs);
    else if (session.mode === 'picture') setProgress(session.idx, session.total);
  }

  function bumpStar(n) {
    session.star += n;
    $('sessionStar').textContent = session.star;
    addStar(n);
  }

  function finishMode() {
    if (session.done) return;
    session.done = true;
    var lv = BANK[curLevel];
    // 清除可能还在的复习小游戏覆盖层
    var ov = document.querySelector('.mini-overlay');
    if (ov) ov.remove();

    // 记录通关
    var list = state.cleared[lv.id] || (state.cleared[lv.id] = []);
    if (list.indexOf(curMode) < 0) list.push(curMode);
    save();

    var perfect = session.wrong === 0;
    var bonus = perfect ? 5 : (session.wrong <= 2 ? 3 : 1);
    bumpStar(bonus);
    sfx(A.win);
    burst(window.innerWidth / 2, window.innerHeight / 2, ['🎉', '⭐', '🌟', '🎊', '🏆']);

    var who = kidName() || '你';
    $('resultEmoji').textContent = perfect ? '🏆' : (session.wrong <= 2 ? '🎉' : '💪');
    $('resultTitle').textContent = perfect
      ? (who + '真厉害，全部答对！')
      : (session.wrong <= 2 ? (who + '做得很棒！') : (who + '完成啦，继续加油！'));
    $('resultSub').textContent = '答对 ' + session.right + ' 次' +
      (session.wrong ? '，再接再厉 ' + session.wrong + ' 次' : '，一题都没错') + '，奖励 ' + bonus + ' 颗星';

    var stars = '';
    var n = Math.min(session.star, 12);
    for (var i = 0; i < n; i++) {
      stars += '<span style="animation-delay:' + (i * 0.08) + 's">⭐</span>';
    }
    $('resultStars').innerHTML = stars;

    var rc = lv.chars.map(function (c) {
      return '<div class="rc' + (knows(c.c) ? '' : ' weak') + '">' + c.c + '</div>';
    }).join('');
    $('resultChars').innerHTML = rc;

    showScreen('screenResult');
    speak([perfect ? '全部答对，' : '完成啦，', who, '真棒']);
  }

  /* ============ 复习小游戏（穿插在主玩法中间） ============ */
  var MINI_KINDS = [
    { name: 'balloon', title: '🎈 听一听，戳破正确的气球！' },
    { name: 'mole',    title: '🐹 听一听，敲对正确的地鼠！' },
    { name: 'apple',   title: '🍎 听一听，摘下正确的苹果！' }
  ];

  /* 创建一个复习小游戏的覆盖层，完成后回调 onDone 继续主玩法 */
  function runMiniGame(onDone) {
    var lv = BANK[curLevel];
    if (!lv || !lv.chars.length) { onDone && onDone(); return; }
    var target = pickOneWeighted(lv.chars);
    var others = pick(distractPool(lv, target.c), 4);
    var opts = shuffle([target].concat(others)).slice(0, 5);
    var kind = pickOne(MINI_KINDS);

    var body = $('gameBody');
    var ov = document.createElement('div');
    ov.className = 'mini-overlay';

    var htmlStr = '<div class="mini-title">' + kind.title + '</div>' +
      '<button class="mini-spk" id="miniSpk">🔊</button>' +
      '<div class="mini-tip">点对了就撒花 🎉</div><div class="' + kind.name + '-field" id="miniField">';

    if (kind.name === 'balloon') {
      var positions = [
        { l: '4%',  t: '15%', dy: '0s' },
        { l: '28%', t: '55%', dy: '.4s' },
        { l: '52%', t: '8%',  dy: '.8s' },
        { l: '70%', t: '48%', dy: '.2s' },
        { l: '85%', t: '18%', dy: '.6s' }
      ];
      htmlStr += opts.map(function (o, i) {
        return '<button class="balloon" data-c="' + o.c + '" style="left:' + positions[i].l +
          ';top:' + positions[i].t + ';animation-delay:' + positions[i].dy + '">' + o.c + '</button>';
      }).join('');
    } else if (kind.name === 'mole') {
      htmlStr += opts.map(function (o) {
        return '<button class="mole" data-c="' + o.c + '"><span class="mole-char">' + o.c + '</span></button>';
      }).join('');
    } else {
      htmlStr += opts.map(function (o) {
        return '<button class="apple" data-c="' + o.c + '">' + o.c + '</button>';
      }).join('');
    }
    htmlStr += '</div><button class="mini-skip" id="miniSkip">跳过 ↪</button>';
    ov.innerHTML = htmlStr;
    body.appendChild(ov);

    var play = function () { speak(target.c, 0.6); };
    $('miniSpk').onclick = function () { sfx(A.click); play(); };
    $('miniSkip').onclick = function () { sfx(A.click); finishMini(); };

    var done = false;
    function finishMini() {
      if (done) return;
      done = true;
      if (ov.parentNode) ov.remove();
      onDone && onDone();
    }

    $('miniField').querySelectorAll('[data-c]').forEach(function (el) {
      el.onclick = function () {
        if (el.classList.contains('pop') || el.classList.contains('hit') || el.classList.contains('pick')) return;
        var c = el.getAttribute('data-c');
        if (c === target.c) {
          if (kind.name === 'balloon') el.classList.add('pop');
          else if (kind.name === 'mole') el.classList.add('up', 'hit');
          else el.classList.add('pick');
          sfx(A.pop);
          session.right++;
          markLearned(target.c, 1);
          bumpStar(1);
          bubble(pickOne(PRAISE));
          var r = el.getBoundingClientRect();
          burst(r.left + r.width / 2, r.top + r.height / 2);
          var w = target.w && target.w[0];
          if (w) setTimeout(function () { speak(w, 0.65); }, 800);
          // 顺便把字标为本关认识的（更新首页进度）
          setTimeout(finishMini, 1300);
        } else {
          sfx(A.wrong);
          session.wrong++;
          markWrong(c);   // 记下被点错的字（加重权重，下次优先练）
          bubble(pickOne(CHEER));
          try {
            el.animate([{ transform: 'translateX(-8px)' }, { transform: 'translateX(8px)' }, { transform: 'none' }], 320);
          } catch (e) {}
          play();
        }
      };
    });
    setTimeout(play, 350);
  }

  /* ============ 玩法一：学一学 ============ */
  function startLearn() {
    var lv = BANK[curLevel];
    session.total = lv.chars.length;
    session.idx = 0;
    updateProgress();
    renderLearn();
  }

  function renderLearn() {
    var lv = BANK[curLevel];
    var ch = lv.chars[session.idx];
    var body = $('gameBody');
    body.innerHTML =
      '<div class="flash-card" id="flashCard">' +
        '<div class="fc-pinyin">' + ch.p + '</div>' +
        '<div class="fc-char">' + ch.c + '</div>' +
        '<div class="fc-emoji">' + ch.e + '</div>' +
      '</div>' +
      '<div class="flash-words">' +
        ch.w.map(function (w) { return '<div class="word-tag" data-w="' + w + '">' + w + '</div>'; }).join('') +
      '</div>' +
      '<div class="learn-nav">' +
        '<button class="btn big ghost" id="prevCard"' + (session.idx === 0 ? ' disabled' : '') + '>← 上一个</button>' +
        '<button class="btn big" id="speakCard">🔊 读一读</button>' +
        '<button class="btn big" id="nextCard">' + (session.idx === lv.chars.length - 1 ? '完成啦 ✓' : '下一个 →') + '</button>' +
      '</div>' +
      '<div class="hint-speak">点一点大卡片，也能听到读音哦</div>';

    var say = function () {
      sfx(A.click);
      speak([ch.c, ch.w[0]]);   // 念字 → 念组词，自动衔接
    };
    $('flashCard').onclick = say;
    $('speakCard').onclick = say;
    body.querySelectorAll('.word-tag').forEach(function (t) {
      t.onclick = function () { sfx(A.click); speak(t.getAttribute('data-w'), 0.65); };
    });
    $('prevCard').onclick = function () {
      sfx(A.click);
      if (session.idx > 0) { session.idx--; updateProgress(); renderLearn(); }
    };
    $('nextCard').onclick = function () {
      sfx(A.click);
      markLearned(ch.c, 1);
      if (session.idx < lv.chars.length - 1) {
        session.idx++;
        updateProgress();
        renderLearn();
      } else {
        session.right = lv.chars.length;
        finishMode();
      }
    };
    // 自动读一次
    setTimeout(say, 300);
  }

  /* 干扰字池：优先用本关的字和已经认识的字，生僻的排后面 */
  function distractPool(lv, excludeChar) {
    var all = [];
    BANK.forEach(function (b) { all = all.concat(b.chars); });
    var lvSet = {};
    lv.chars.forEach(function (c) { lvSet[c.c] = 1; });
    var seen = {}, pref = [], rest = [];
    all.forEach(function (c) {
      if (c.c === excludeChar || seen[c.c]) return;
      seen[c.c] = 1;
      if (lvSet[c.c] || knows(c.c)) pref.push(c); else rest.push(c);
    });
    return shuffle(pref.concat(rest));
  }

  /* ============ 玩法二：听音选字 ============ */
  function startListen() {
    var lv = BANK[curLevel];
    session.pool = distractPool(lv, null);
    session.list = pickWeighted(lv.chars, Math.min(8, lv.chars.length));
    session.total = session.list.length;
    session.idx = 0;
    updateProgress();
    renderListen();
  }

  function renderListen() {
    var ch = session.list[session.idx];
    var others = pick(session.pool.filter(function (c) { return c.c !== ch.c; }), 3);
    var opts = shuffle([ch].concat(others));
    var body = $('gameBody');
    body.innerHTML =
      '<div class="question-prompt">仔细听，是哪个字呀？</div>' +
      '<button class="speaker-btn" id="spkBtn">🔊</button>' +
      '<div class="hint-speak">没听清？再点一下喇叭</div>' +
      '<div class="opt-grid" id="optGrid">' +
        opts.map(function (o) { return '<button class="opt" data-c="' + o.c + '">' + o.c + '</button>'; }).join('') +
      '</div>';

    var play = function () {
      var b = $('spkBtn');
      b.classList.add('playing');
      setTimeout(function () { b.classList.remove('playing'); }, 500);
      speak(ch.c, 0.62);
    };
    $('spkBtn').onclick = function () { sfx(A.click); play(); };

    body.querySelectorAll('.opt').forEach(function (btn) {
      btn.onclick = function (ev) {
        if (btn.classList.contains('right')) return;
        var c = btn.getAttribute('data-c');
        if (c === ch.c) {
          btn.classList.add('right');
          sfx(A.correct);
          session.right++;
          markLearned(ch.c, 1);
          bumpStar(1);
          var r = btn.getBoundingClientRect();
          burst(r.left + r.width / 2, r.top + r.height / 2);
          bubble(pickOne(PRAISE));
          speak(ch.w[0], 0.7);
          setTimeout(function () {
            session.idx++;
            session.quizCount = (session.quizCount || 0) + 1;
            updateProgress();
            if (session.idx >= session.list.length) { finishMode(); return; }
            // 每 3 题穿插一个复习小游戏，避免孩子走神
            if (session.quizCount % 3 === 0) {
              runMiniGame(renderListen);
            } else {
              renderListen();
            }
          }, 1400);
        } else {
          btn.classList.add('wrong');
          sfx(A.wrong);
          session.wrong++;
          markWrong(c);   // 记下被点错的字
          bubble(pickOne(CHEER));
          setTimeout(function () { btn.classList.remove('wrong'); }, 600);
          play();
        }
      };
    });
    setTimeout(play, 350);
  }

  /* ============ 玩法三：找字游戏 ============ */
  function startFind() {
    var lv = BANK[curLevel];
    session.totalRounds = 5;
    session.round = 0;
    updateProgress();
    renderFind();
  }

  function renderFind() {
    var lv = BANK[curLevel];
    var target = pickOneWeighted(lv.chars);
    var hits = 3;
    var others = pick(distractPool(lv, target.c), 9);
    var cells = shuffle(
      new Array(hits).fill(target).concat(others)
    );
    var body = $('gameBody');
    body.innerHTML =
      '<div class="find-target">' +
        '<span class="t-label">请找出</span>' +
        '<span class="t-char">' + target.c + '</span>' +
        '<span class="t-pinyin">' + target.p + '</span>' +
        '<button class="btn small" id="spkBtn2">🔊 听一听</button>' +
      '</div>' +
      '<div class="find-grid" id="findGrid">' +
        cells.map(function (c, i) {
          return '<button class="cell" data-c="' + c.c + '" data-ok="' + (c.c === target.c ? 1 : 0) + '">' + c.c + '</button>';
        }).join('') +
      '</div>' +
      '<div class="hint-speak">找出 ' + hits + ' 个「' + target.c + '」就过关啦</div>';

    var play = function () { speak(target.c, 0.62); };
    $('spkBtn2').onclick = function () { sfx(A.click); play(); };

    var left = hits;
    body.querySelectorAll('.cell').forEach(function (cell) {
      cell.onclick = function () {
        if (cell.classList.contains('hit')) return;
        var ok = cell.getAttribute('data-ok') === '1';
        if (ok) {
          cell.classList.add('hit');
          sfx(A.correct);
          session.right++;
          left--;
          var r = cell.getBoundingClientRect();
          burst(r.left + r.width / 2, r.top + r.height / 2);
          markLearned(target.c, 1);
          if (left === 0) {
            bumpStar(1);
            bubble(pickOne(PRAISE));
            setTimeout(function () {
              session.round++;
              updateProgress();
              if (session.round >= session.totalRounds) { finishMode(); return; }
              // 每 2 轮穿插一个复习小游戏，避免单调
              if (session.round % 2 === 0) {
                runMiniGame(renderFind);
              } else {
                renderFind();
              }
            }, 900);
          }
        } else {
          cell.classList.add('miss');
          sfx(A.wrong);
          session.wrong++;
          markWrong(cell.getAttribute('data-c'));   // 记下被点错的字
          setTimeout(function () { cell.classList.remove('miss'); }, 600);
        }
      };
    });
    setTimeout(play, 300);
  }

  /* ============ 玩法四：配对游戏 ============ */
  function startMatch() {
    var lv = BANK[curLevel];
    var pairs = pickWeighted(lv.chars, 6);
    session.pairs = 0;
    session.totalPairs = pairs.length;
    updateProgress();
    renderMatch(pairs);
  }

  function renderMatch(pairs) {
    var left = pairs.map(function (c) { return { key: c.c, type: 'c', show: c.c, ref: c }; });
    var right = pairs.map(function (c) { return { key: c.c, type: 'e', show: c.e, ref: c }; });
    var cards = shuffle(left.concat(right));
    var body = $('gameBody');
    body.innerHTML =
      '<div class="match-info"><span>把字和它的图片配成一对</span><span>还差 <b id="mLeft">' + pairs.length + '</b> 对</span></div>' +
      '<div class="match-grid" id="matchGrid">' +
        cards.map(function (cd, i) {
          return '<button class="mcard" data-key="' + cd.key + '" data-type="' + cd.type + '" data-c="' + cd.c + '" data-i="' + i + '">' +
            (cd.type === 'c' ? '<span class="m-char">' + cd.show + '</span>' : '<span>' + cd.show + '</span>') +
            '</button>';
        }).join('') +
      '</div>' +
      '<div class="hint-speak">先点一个字，再点它的图片</div>';

    var grid = $('matchGrid');
    var sel = null;
    var remain = pairs.length;

    grid.querySelectorAll('.mcard').forEach(function (card) {
      card.onclick = function () {
        if (card.classList.contains('done') || card.classList.contains('sel')) return;
        sfx(A.click);
        card.classList.add('sel');
        if (!sel) { sel = card; return; }
        var k1 = sel.getAttribute('data-key'), k2 = card.getAttribute('data-key');
        var t1 = sel.getAttribute('data-type'), t2 = card.getAttribute('data-type');
        if (k1 === k2 && t1 !== t2) {
          sel.classList.remove('sel');
          card.classList.remove('sel');
          sel.classList.add('done');
          card.classList.add('done');
          var a = sel, b = card;
          sel = null;
          setTimeout(function () {
            if (a.parentNode) a.parentNode.removeChild(a);
            if (b.parentNode) b.parentNode.removeChild(b);
          }, 360);
          remain--;
          session.right++;
          session.pairs++;
          updateProgress();
          $('mLeft').textContent = remain;
          markLearned(k1, 1);
          bumpStar(1);
          sfx(A.correct);
          var r = card.getBoundingClientRect();
          burst(r.left + r.width / 2, r.top + r.height / 2);
          bubble(pickOne(PRAISE));
          var ch = pairs.filter(function (p) { return p.c === k1; })[0];
          speak(ch ? [k1, ch.w[0]] : k1);   // 念字 → 念组词，自动衔接
          // 每配对 3 对穿插一个复习小游戏（覆盖层，不破坏卡片）
          session.miniCount = (session.miniCount || 0) + 1;
          if (session.miniCount % 3 === 0 && remain > 0) {
            runMiniGame(function () { /* match 卡片自然继续 */ });
          }
          if (remain === 0) setTimeout(finishMode, 1800);
        } else {
          sfx(A.wrong);
          session.wrong++;
          markWrong(sel.getAttribute('data-c'));
          markWrong(card.getAttribute('data-c'));
          bubble(pickOne(CHEER));
          var a = sel, b = card;
          sel = null;
          setTimeout(function () { a.classList.remove('sel'); b.classList.remove('sel'); }, 700);
        }
      };
    });
  }

  /* ============ 玩法五：看图选字 ============ */
  function startPicture() {
    var lv = BANK[curLevel];
    session.pool = distractPool(lv, null);
    // 看图选字偏「回忆」，优先出已经见过的字来巩固；不够再用新字补足
    var need = Math.min(8, lv.chars.length);
    var known = lv.chars.filter(function (c) { return knows(c.c); });
    var fresh = lv.chars.filter(function (c) { return !knows(c.c); });
    var list = known.slice();
    while (list.length < need && fresh.length) {
      list.push(fresh.splice(Math.floor(Math.random() * fresh.length), 1)[0]);
    }
    session.list = pickWeighted(list, need);
    session.total = session.list.length;
    session.idx = 0;
    updateProgress();
    renderPicture();
  }

  function renderPicture() {
    var ch = session.list[session.idx];
    // 干扰项的配图不能和答案一样，否则图片本身有歧义
    var others = pick(session.pool.filter(function (c) {
      return c.c !== ch.c && c.e !== ch.e;
    }), 3);
    var opts = shuffle([ch].concat(others));
    var body = $('gameBody');
    body.innerHTML =
      '<div class="picture-card" id="picCard"><span class="pic-emoji">' + ch.e + '</span></div>' +
      '<div class="question-prompt">看图片，选出对应的字</div>' +
      '<div class="opt-grid" id="picGrid">' +
        opts.map(function (o) { return '<button class="opt" data-c="' + o.c + '">' + o.c + '</button>'; }).join('') +
      '</div>' +
      '<div class="pic-tools">' +
        '<button class="btn small ghost" id="picHint">💡 提示词语</button>' +
        '<span class="pic-hint" id="picHintBox"></span>' +
      '</div>';

    // 点图片只放大一下，不朗读 —— 一读就等于直接报答案了
    var pic = $('picCard');
    pic.onclick = function () {
      sfx(A.click);
      try { pic.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], 320); } catch (e) {}
    };
    // 提示：把组词里的目标字挖空（如 水□ / 苹□），让孩子顺着词语猜，不直接给答案
    $('picHint').onclick = function () {
      sfx(A.click);
      var masked = ch.w.map(function (w) {
        return w.split('').map(function (x) { return x === ch.c ? '□' : x; }).join('');
      }).join('　');
      $('picHintBox').textContent = '想一想：' + masked;
    };

    body.querySelectorAll('#picGrid .opt').forEach(function (btn) {
      btn.onclick = function () {
        if (btn.classList.contains('right')) return;
        var c = btn.getAttribute('data-c');
        if (c === ch.c) {
          btn.classList.add('right');
          sfx(A.correct);
          session.right++;
          markLearned(ch.c, 1);
          bumpStar(1);
          var r = btn.getBoundingClientRect();
          burst(r.left + r.width / 2, r.top + r.height / 2);
          bubble(pickOne(PRAISE));
          speak([ch.c, ch.w[0]]);   // 答对后念字 → 念组词，加深印象
          setTimeout(function () {
            session.idx++;
            session.quizCount = (session.quizCount || 0) + 1;
            updateProgress();
            if (session.idx >= session.list.length) { finishMode(); return; }
            // 每 3 题穿插一个复习小游戏，避免孩子走神
            if (session.quizCount % 3 === 0) {
              runMiniGame(renderPicture);
            } else {
              renderPicture();
            }
          }, 1500);
        } else {
          btn.classList.add('wrong');
          sfx(A.wrong);
          session.wrong++;
          markWrong(c);   // 记下被点错的字
          bubble(pickOne(CHEER));
          setTimeout(function () { btn.classList.remove('wrong'); }, 600);
        }
      };
    });
  }

  /* ============ 家长面板 ============ */
  function renderParent() {
    var totalKnown = 0, totalMastered = 0, totalChars = 0;
    BANK.forEach(function (lv) {
      totalChars += lv.chars.length;
      lv.chars.forEach(function (c) {
        if (knows(c.c)) totalKnown++;
        if (mastered(c.c)) totalMastered++;
      });
    });
    var clearedLevels = BANK.filter(function (lv) { return (state.cleared[lv.id] || []).length > 0; }).length;

    $('statRow').innerHTML =
      stat(state.stars, '获得星星') +
      stat(totalKnown + '/' + totalChars, '见过的字') +
      stat(totalMastered, '比较熟悉的字') +
      stat(clearedLevels + '/' + BANK.length, '玩过的关卡');

    var html = '';
    BANK.forEach(function (lv) {
      html += '<div style="width:100%;text-align:center;font-weight:800;color:#7A7A8C;margin:12px 0 6px">' +
        lv.icon + ' ' + lv.name + '</div>';
      html += lv.chars.map(function (c) {
        var n = state.mastery[c.c] || 0;
        var w = state.wrong[c.c] || 0;
        var cls = n >= 3 ? 'lv3' : (n >= 1 ? 'lv2' : 'lv1');
        var badge = w > 0 ? '<div class="mcell-warn">错 ' + w + '</div>' : '';
        return '<div class="mcell ' + cls + '">' + badge + '<div class="mc">' + c.c + '</div><div class="mn">' +
          (n === 0 ? '没见过' : n + ' 次') + '</div></div>';
      }).join('');
    });
    $('masteryGrid').innerHTML = html;
    $('masteryTip').textContent = '浅黄＝还没练过（0次）　浅蓝＝见过1-2次　浅绿＝练过3次以上，比较熟了。右上角红标 = 反复错过';

    // 容易错的字（按错次数降序，最多 12 个）
    var weak = [];
    BANK.forEach(function (lv) { lv.chars.forEach(function (c) {
      var w = state.wrong[c.c] || 0;
      if (w > 0) weak.push({ c: c.c, lv: lv.name, w: w });
    }); });
    weak.sort(function (a, b) { return b.w - a.w; });
    weak = weak.slice(0, 12);
    if (weak.length) {
      $('weakGrid').innerHTML = weak.map(function (x) {
        var hot = x.w >= 4 ? 'hot' : (x.w >= 2 ? 'warm' : 'mild');
        return '<div class="wcell ' + hot + '">' +
          '<div class="wc">' + x.c + '</div>' +
          '<div class="wn">错 ' + x.w + ' 次</div>' +
        '</div>';
      }).join('');
      $('weakTip').textContent = '「' + weak[0].c + '」错得最多（共 ' + weak[0].w + ' 次），在游戏中会重点复习。';
    } else {
      $('weakGrid').innerHTML = '<div class="empty-tip">✨ 还没有错题记录。孩子答错时会自动出现在这里。</div>';
      $('weakTip').textContent = '';
    }

    // 孩子名字
    $('inName').value = state.name || '';

    // 自定义字表
    $('inCustom').value = (state.custom || []).map(function (c) {
      return [c.c, c.p].concat(c.w || []).join(' ');
    }).join('\n');
    $('customStatus').textContent = state.custom && state.custom.length
      ? ('已加 ' + state.custom.length + ' 个字，会出现在首页「✏️ 我自己的字」这一关')
      : '还没有自定义字（加上之后会成为首页的第 ' + (BANK.length + 1) + ' 关）';

    // 朗读声音
    renderVoiceCards();
    refreshVoiceSelect();
    updateVoiceStatus();

    $('chkUnlock').checked = state.unlockAll;
    $('chkSound').checked = state.sound;
    showScreen('screenParent');
  }

  /* 声音卡片：两个云声音 + 系统语音，点卡片切换，点 🔊 试听 */
  function renderVoiceCards() {
    var box = $('voiceCards');
    if (!box) return;
    var cards = A.cloudList();
    var html = '';
    cards.forEach(function (v) {
      var on = (state.cloudVoice === v.key);
      html += '<div class="vcard' + (on ? ' on' : '') + '" data-v="' + v.key + '">' +
        '<div class="vcard-main">' +
          '<div class="vcard-name">' + v.label + '</div>' +
          '<div class="vcard-sub">真人级发音 · 已备好 ' + v.count + ' 条</div>' +
        '</div>' +
        '<button class="vcard-try" data-try="' + v.key + '" title="试听">🔊</button>' +
      '</div>';
    });
    html += '<div class="vcard' + (state.cloudVoice === 'system' ? ' on' : '') + '" data-v="system">' +
      '<div class="vcard-main">' +
        '<div class="vcard-name">💻 系统语音</div>' +
        '<div class="vcard-sub">电脑自带，声音偏机械（不推荐）</div>' +
      '</div>' +
      '<button class="vcard-try" data-try="system" title="试听">🔊</button>' +
    '</div>';
    box.innerHTML = html;

    box.querySelectorAll('.vcard').forEach(function (c) {
      c.onclick = function () {
        var k = c.getAttribute('data-v');
        state.cloudVoice = k;
        A.setCloudVoice(k);
        save();
        renderVoiceCards();
        updateVoiceStatus();
        sfx(A.click);
        speak(trySentence());
      };
    });
    box.querySelectorAll('.vcard-try').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        var k = b.getAttribute('data-try');
        var saved = state.cloudVoice;
        state.cloudVoice = k; A.setCloudVoice(k);
        speak(trySentence(), {
          done: function () { state.cloudVoice = saved; A.setCloudVoice(saved); }
        });
      };
    });
  }

  function refreshVoiceSelect() {
    var sel = $('selVoice');
    var list = A.listVoices();
    var cur = state.voiceURI || A.currentVoiceURI();
    sel.innerHTML = '';
    if (!list.length) {
      var o = document.createElement('option');
      o.textContent = '浏览器暂未列出中文语音';
      sel.appendChild(o);
      return;
    }
    list.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v.uri;
      opt.textContent = v.name;
      if (v.uri === cur) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function updateVoiceStatus() {
    var el = $('voiceStatus'), tip = $('sysVoiceTip');
    var label, extra;
    if (state.cloudVoice === 'system') {
      label = '💻 系统语音（' + (A.currentVoiceName() || '自动选择') + '）';
      extra = '云音频已停用，全部走电脑自带语音，声音会比较机械。';
    } else {
      label = A.cloudLabel(state.cloudVoice);
      extra = '云音频已启用。只有没预先生成的字（比如自定义字库里的生僻字）才会用到下面的系统语音。';
    }
    if (el) el.textContent = '当前声音：' + label;
    if (tip) tip.textContent = extra;
  }

  function stat(v, label) {
    return '<div class="stat"><b>' + v + '</b><span>' + label + '</span></div>';
  }

  /* ============ 事件绑定 ============ */
  function init() {
    load();
    syncBank();

    $('btnHome').onclick = function () { sfx(A.click); renderHome(); };
    $('btnBackHome').onclick = function () { sfx(A.click); renderHome(); };
    $('btnQuit').onclick = function () { sfx(A.click); openLevel(curLevel); };
    $('btnBackLevel').onclick = function () { sfx(A.click); openLevel(curLevel); };
    $('btnResultHome').onclick = function () { sfx(A.click); renderHome(); };
    $('btnAgain').onclick = function () { sfx(A.click); startMode(curMode); };

    $('btnParent').onclick = function () { sfx(A.click); renderParent(); };
    $('btnParentBack').onclick = function () { sfx(A.click); renderHome(); };

    document.querySelectorAll('.mode-card').forEach(function (btn) {
      btn.onclick = function () { sfx(A.click); startMode(btn.getAttribute('data-mode')); };
    });

    $('chkUnlock').onchange = function () { state.unlockAll = this.checked; save(); };
    $('chkSound').onchange = function () {
      state.sound = this.checked;
      save();
      if (state.sound) { sfx(A.click); speak('声音打开啦'); }
    };
    $('btnReset').onclick = function () {
      if (confirm('确定要清空所有学习记录和星星吗？清空后不能恢复哦。')) {
        state.stars = 0; state.mastery = {}; state.wrong = {}; state.cleared = {};
        save(); renderParent(); toast('记录已清空');
      }
    };

    // 孩子名字
    $('btnSaveName').onclick = function () {
      var v = $('inName').value.trim();
      state.name = v || '远宝';
      save(); applyName();
      toast(state.name ? '已保存：' + state.name : '已清空名字');
    };

    // 自定义字表
    $('btnSaveCustom').onclick = function () {
      var list = parseCustom($('inCustom').value);
      state.custom = list;
      save(); syncBank();
      $('customStatus').textContent = '已加 ' + list.length + ' 个字，会出现在首页「✏️ 我自己的字」这一关';
      toast(list.length ? ('加好了 ' + list.length + ' 个字') : '没识别出有效字');
    };
    $('btnClearCustom').onclick = function () {
      state.custom = [];
      save(); syncBank();
      $('inCustom').value = '';
      $('customStatus').textContent = '已清空自定义字';
      toast('已清空自定义字');
    };

    // 声音选择
    $('selVoice').onchange = function () {
      state.voiceURI = this.value;
      A.setVoiceURI(this.value);
      save();
      updateVoiceStatus();
    };
    $('btnTryVoice').onclick = function () {
      A.setVoiceURI($('selVoice').value);
      state.voiceURI = $('selVoice').value;
      save();
      updateVoiceStatus();
      // 试听系统语音时必须临时切到 system，否则听到的还是云音频
      var saved = state.cloudVoice;
      state.cloudVoice = 'system'; A.setCloudVoice('system');
      speak(trySentence(), {
        done: function () { state.cloudVoice = saved; A.setCloudVoice(saved); }
      });
    };

    // 当系统语音加载完成，若家长面板已开，刷新下拉
    A.onVoicesChanged(function () {
      if (!$('screenParent').classList.contains('hidden')) {
        refreshVoiceSelect();
        updateVoiceStatus();
      }
    });

    // 应用默认声音 + 名字到首页
    A.setVoiceURI(state.voiceURI);
    A.setCloudVoice(state.cloudVoice);
    applyName();

    if (A.hasCloud()) {
      var n = A.cloudList().length;
      console.log('[识字游戏] 已加载 ' + n + ' 个云朗读声音：' + A.cloudList().map(function (v) { return v.key; }).join('、'));
    } else if (!A.canSpeak()) {
      toast('这个浏览器不能朗读，游戏可以照常玩');
    }
    if (!storageOK()) {
      setTimeout(function () { toast('这个浏览器不能保存进度，换 Edge 或 Chrome 打开就能记住啦'); }, 2200);
    }

    renderHome();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
