/* 识字游戏 - 声音模块
 *
 * 两条发声通道：
 *  1) 【云音频】预生成的微软神经网络女声 mp3（Xiaoxiao / Xiaoyi），真人级音质，优先使用
 *  2) 【系统语音】浏览器自带 TTS，作为兜底（云音频里没有的那句话才会用到）
 *
 * 音效：Web Audio API 现场合成，无需外部音频文件
 */
(function () {
  var GA = {};                 // 注意：不能叫 Audio，会遮蔽浏览器全局的 Audio 构造函数

  var synth = ('speechSynthesis' in window) ? window.speechSynthesis : null;

  /* ---------------- 云音频 ---------------- */
  var cloudVoice = 'xiaoxiao';   // 'xiaoxiao' | 'xiaoyi' | 'system'
  var CLOUD_LABEL = {             // manifest 没加载时的兜底说明
    xiaoxiao: '☁️ 云朵姐姐（温柔甜美）',
    xiaoyi: '🌸 小樱姐姐（活泼可爱）'
  };

  function manifest() { return window.AUDIO_MANIFEST || null; }

  /** 某句话在当前云声音里有没有现成 mp3 */
  function cloudFile(text) {
    if (cloudVoice === 'system') return null;
    var m = manifest();
    if (!m) return null;
    var v = m[cloudVoice];
    if (!v || !v.map) return null;
    var fn = v.map[text];
    if (!fn) return null;
    return (v.dir || ('audio/' + cloudVoice + '/')) + fn;
  }

  GA.hasCloud = function () {
    var m = manifest();
    return !!(m && (m.xiaoxiao || m.xiaoyi));
  };
  GA.cloudList = function () {
    var m = manifest(), out = [];
    if (!m) return out;
    ['xiaoxiao', 'xiaoyi'].forEach(function (k) {
      if (m[k]) out.push({ key: k, label: m[k].label || CLOUD_LABEL[k], count: Object.keys(m[k].map || {}).length });
    });
    return out;
  };
  GA.setCloudVoice = function (k) { cloudVoice = k || 'system'; };
  GA.getCloudVoice = function () { return cloudVoice; };
  GA.cloudLabel = function (k) {
    var m = manifest();
    if (m && m[k] && m[k].label) return m[k].label;
    return CLOUD_LABEL[k] || k;
  };

  /* ---------------- 系统语音（兜底） ---------------- */
  /* 好听程度排名：女声优先，男声和本地机械音靠后 */
  var PREF_FEMALE = ['xiaoxiao', 'xiaoyi', 'yaoyao', 'huihui', 'tingting', 'xiaohan', 'xiaomeng', 'xiaomo', 'xiaoxuan'];
  var PREF_MALE = ['yunxi', 'yunyang', 'yunjian', 'yunxia', 'kangkang'];
  var PREF_OTHER = ['google'];

  var voices = [];
  var voice = null;
  var forcedURI = null;
  var listeners = [];

  function score(v) {
    var n = (v.name || '').toLowerCase();
    var s = 0;
    if (/online|natural|neural|cloud|premium/.test(n)) s += 100;
    if (/desktop/.test(n)) s -= 40;
    var i;
    for (i = 0; i < PREF_FEMALE.length; i++) {
      if (n.indexOf(PREF_FEMALE[i]) >= 0) { s += 80 - i; return s; }   // 女声 +80 起
    }
    for (i = 0; i < PREF_OTHER.length; i++) {
      if (n.indexOf(PREF_OTHER[i]) >= 0) { s += 40 - i; return s; }
    }
    for (i = 0; i < PREF_MALE.length; i++) {
      if (n.indexOf(PREF_MALE[i]) >= 0) { s += 10 - i; return s; }     // 男声兜底
    }
    return s;
  }

  function refresh() {
    if (!synth) return;
    var all = synth.getVoices() || [];
    voices = all.filter(function (v) { return /^zh/i.test(v.lang || ''); });
    if (!voices.length) { voice = null; return; }

    if (forcedURI) {
      for (var i = 0; i < voices.length; i++) {
        if (voices[i].voiceURI === forcedURI) { voice = voices[i]; return; }
      }
    }
    var best = voices[0], bs = -1e9;
    voices.forEach(function (v) {
      var s = score(v);
      if (s > bs) { bs = s; best = v; }
    });
    voice = best;
    listeners.forEach(function (cb) { try { cb(); } catch (e) {} });
  }

  if (synth) {
    refresh();
    synth.onvoiceschanged = refresh;
    setTimeout(refresh, 400);
    setTimeout(refresh, 1500);
  }

  /* ---------------- 播放核心 ---------------- */
  var mp3 = null;        // 正在播放的 Audio 元素
  var seqToken = 0;      // 朗读序列令牌，用于打断

  function stopMp3() {
    if (mp3) {
      try { mp3.pause(); mp3.currentTime = 0; } catch (e) {}
      mp3.onended = mp3.onerror = null;
      mp3 = null;
    }
  }
  function stopTts() { if (synth) { try { synth.cancel(); } catch (e) {} } }
  GA.stop = function () { seqToken++; stopMp3(); stopTts(); };

  /** 播放单个片段，播完调 done(ok) —— ok=false 表示没播成，调用方可回退 */
  function playOne(text, done) {
    var url = cloudFile(text);
    if (url) {
      stopMp3();
      var a = new Audio(url);
      a.preload = 'auto';
      mp3 = a;
      var finished = false;
      var finish = function (ok) {
        if (finished) return;
        finished = true;
        if (mp3 === a) mp3 = null;
        a.onended = a.onerror = null;
        done(!!ok);
      };
      a.onended = function () { finish(true); };
      a.onerror = function () { finish(false); };
      var p = a.play();
      if (p && p.catch) {
        p.catch(function () {
          // 被浏览器拦截或解码失败 → 交给系统 TTS
          finish(false);
        });
      }
      // 兜底：10 秒还没结束就算完（防止 onended 不触发卡住整条序列）
      setTimeout(function () { finish(true); }, 10000);
      return;
    }

    // 没有现成音频 → 系统 TTS
    if (!synth) { done(false); return; }
    try {
      var u = new SpeechSynthesisUtterance(String(text));
      u.lang = 'zh-CN';
      if (voice) u.voice = voice;
      u.rate = 0.62;       // 放慢，小朋友听得清
      u.pitch = 1.12;      // 音调稍高，更亲切
      u.volume = 1;
      u.onend = function () { done(true); };
      u.onerror = function () { done(false); };
      synth.speak(u);
      setTimeout(function () { done(true); }, 8000);   // 兜底
    } catch (e) { done(false); }
  }

  /**
   * 读一段话。opts: { rate, pitch, done }
   * 支持传数组做"拼接朗读"：['全部答对，', '远宝', '真棒'] 会依次播放。
   * 数组里只要有任一片段没有现成云音频，就整句合并后用系统语音读一遍，
   * 避免一半真人声一半机械声的割裂感。
   */
  GA.speak = function (text, opts) {
    opts = opts || {};
    var parts = Array.isArray(text) ? text.slice() : [text];
    parts = parts.filter(function (t) { return t !== null && t !== undefined && t !== ''; });
    if (!parts.length) { if (opts.done) opts.done(); return false; }

    var token = ++seqToken;
    stopMp3();
    stopTts();

    // 拼接模式下，先检查每一片是否都有云音频
    var allCloud = parts.every(function (t) { return !!cloudFile(t); });
    if (!allCloud && parts.length > 1) {
      // 有片段缺失 → 合并成一句，走系统语音（音色统一）
      parts = [parts.join('')];
      var saved = cloudVoice;
      cloudVoice = 'system';
      playOne(parts[0], function () {
        cloudVoice = saved;
        if (opts.done) opts.done();
      });
      return true;
    }

    var i = 0;
    (function next() {
      if (token !== seqToken) return;             // 已被新的朗读打断
      if (i >= parts.length) { if (opts.done) opts.done(); return; }
      var t = parts[i++];
      playOne(t, function () {
        if (token !== seqToken) return;
        setTimeout(next, 220);                    // 片段之间留一点呼吸
      });
    })();
    return true;
  };

  /** 字 → 组词 连读（比固定 setTimeout 衔接自然得多） */
  GA.speakWord = function (char, word, done) {
    GA.speak([char, word], { done: done });
  };

  GA.canSpeak = function () { return !!synth || GA.hasCloud(); };
  GA.currentVoiceName = function () { return voice ? voice.name : ''; };
  GA.currentVoiceURI = function () { return voice ? voice.voiceURI : null; };
  GA.listVoices = function () {
    return voices.map(function (v) { return { name: v.name, uri: v.voiceURI }; });
  };
  GA.setVoiceURI = function (uri) { forcedURI = uri || null; refresh(); };
  GA.onVoicesChanged = function (cb) { if (cb) listeners.push(cb); };

  /* ---------------- 音效合成 ---------------- */
  var ctx = null;
  function ac() {
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  window.addEventListener('pointerdown', function () { ac(); }, { once: true });

  function tone(freq, start, dur, type, vol) {
    var c = ac();
    if (!c) return;
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, c.currentTime + start);
    g.gain.setValueAtTime(0.0001, c.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol || 0.25, c.currentTime + start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(c.currentTime + start);
    o.stop(c.currentTime + start + dur + 0.05);
  }

  function gliss(from, to, start, dur, type, vol) {
    var c = ac();
    if (!c) return;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(from, c.currentTime + start);
    o.frequency.exponentialRampToValueAtTime(to, c.currentTime + start + dur);
    g.gain.setValueAtTime(0.0001, c.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, c.currentTime + start + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + start);
    o.stop(c.currentTime + start + dur + 0.05);
  }

  GA.click = function () { tone(680, 0, 0.09, 'triangle', 0.16); };
  GA.correct = function () {
    tone(660, 0, 0.14, 'sine', 0.22);
    tone(880, 0.11, 0.16, 'sine', 0.22);
    tone(1174, 0.23, 0.26, 'sine', 0.2);
  };
  GA.wrong = function () {
    tone(300, 0, 0.16, 'sawtooth', 0.12);
    tone(220, 0.13, 0.2, 'sawtooth', 0.1);
  };
  GA.star = function () {
    tone(880, 0, 0.12, 'triangle', 0.18);
    tone(1320, 0.1, 0.18, 'triangle', 0.16);
  };
  GA.pop = function () {
    gliss(900, 180, 0, 0.18, 'square', 0.14);
    tone(180, 0.02, 0.12, 'sine', 0.12);
  };
  GA.boing = function () { gliss(300, 700, 0, 0.22, 'triangle', 0.16); };
  GA.win = function () {
    var seq = [523, 659, 784, 1047];
    for (var i = 0; i < seq.length; i++) tone(seq[i], i * 0.13, 0.3, 'sine', 0.2);
    tone(1568, 0.55, 0.5, 'sine', 0.18);
  };

  window.GameAudio = GA;
})();
