{
  // Retro Gauge Clock v0.10
  // Retrograde minutes + jump hour, dashboard cluster, touch controls,
  // pressure-trend chevrons.
  const locale = require("locale");

  // ---- persisted settings (see settings.js) ----
  let cfg = require('Storage').readJSON('retrogauge.json', 1) || {};
  function saveCfg() { require('Storage').writeJSON('retrogauge.json', cfg); }

  // ---- themes (safe 3-bit palette) ----
  const THEMES = [
    { DIAL:0x07FF, RIB:0x0000, FAN:0x0000, SCALE:0xFFFF, NDL:0xF800, CHG:0xFFE0, DISC:0x07FF, HOUR:0x0000, DIM:0x001F }, // Mint
    { DIAL:0xFFFF, RIB:0x0000, FAN:0x0000, SCALE:0xFFFF, NDL:0xF800, CHG:0xFFE0, DISC:0xFFFF, HOUR:0x0000, DIM:0x001F }, // Silver
    { DIAL:0x0000, RIB:0x001F, FAN:0x0000, SCALE:0xFFFF, NDL:0xFFE0, CHG:0x07E0, DISC:0xFFFF, HOUR:0x0000, DIM:0x001F }, // Midnight
    { DIAL:0x001F, RIB:0x0000, FAN:0x0000, SCALE:0xFFFF, NDL:0xF800, CHG:0xFFE0, DISC:0x001F, HOUR:0xFFFF, DIM:0x07FF }, // Navy
    { DIAL:0xF800, RIB:0x0000, FAN:0x0000, SCALE:0xFFFF, NDL:0xFFE0, CHG:0x07E0, DISC:0xF800, HOUR:0xFFFF, DIM:0x001F }  // Red
  ];
  let C_DIAL, C_RIB, C_FAN, C_SCALE, C_NDL, C_CHG, C_DISC, C_HOUR, C_DIM;
  function applyTheme() {
    const T = THEMES[(cfg.theme || 0) % THEMES.length];
    C_DIAL = T.DIAL; C_RIB = T.RIB; C_FAN = T.FAN; C_SCALE = T.SCALE;
    C_NDL = T.NDL; C_CHG = T.CHG; C_DISC = T.DISC; C_HOUR = T.HOUR;
    C_DIM = T.DIM;
  }

  // ---- main gauge geometry ----
  const CX = 88, CY = 175;
  const A0 = 130, A1 = 50, FA0 = 136, FA1 = 44;
  const R_FAN = 120, R_T1 = 102, R_NUM = 90, R_TIP = 84;
  const PANEL_Y = 127;
  const HCX = 88, HCY = 151, HR = 22;
  const CHV_L = { x: 40, y: 151, dir: -1 };   // left cluster: FALLING
  const CHV_R = { x: 136, y: 151, dir: 1 };   // right cluster: RISING

  // ---- mini pods + odometer ----
  const PODS = [
    { x: 34,  y: 42, label: "FUEL" },
    { x: 142, y: 42, label: "BPM"  }
  ];
  const PA0 = 160, PA1 = 20, PR = 30;
  const ODO = { x1: 65, y1: 4, x2: 111, y2: 20 };

  let lastMin = -1, lastHour = null;
  let lastVals = [null, null], lastNdl = [null, null], lastSteps = null;
  let odoMode = cfg.odo ? 1 : 0;
  let timer, anim, demoTimer, peekTimer, hrmTimeout, hrmOn = false;
  let trend = (typeof cfg.trend === "number") ? cfg.trend : 0;  // -1/0/1
  let baroTimer, chevBlink, locked = false;

  function pt(a, r) {
    const rad = a * Math.PI / 180;
    return [CX + r * Math.cos(rad), CY - r * Math.sin(rad)];
  }
  const angleFor = (min) => A0 - (min / 60) * (A0 - A1);

  // ======== main minute needle ========
  function drawNeedle(min, col) {
    const rad = angleFor(min) * Math.PI / 180;
    const dx = Math.cos(rad), dy = -Math.sin(rad);
    const rIn = (CY - PANEL_Y + 1) / Math.sin(rad);
    const px = -dy * 4, py = dx * 4;
    const bx = CX + rIn * dx, by = CY + rIn * dy;
    g.setColor(col).fillPoly([
      bx + px, by + py,
      bx - px, by - py,
      CX + R_TIP * dx, CY + R_TIP * dy
    ]);
  }

  // ======== pressure-trend chevrons ========
  // Each cluster is three ">"-shaped chevrons stacked toward HCX. `lit`
  // draws them in the highlight colour; unlit draws them dim (background
  // fan colour outline only) so an inactive cluster reads as "off".
  function drawChevrons(cluster, lit) {
    // erase first so a lit->unlit transition doesn't leave bold strokes
    const s0 = cluster.dir;
    g.setColor(C_FAN).fillRect(
      Math.min(cluster.x - 2, cluster.x + s0 * 29),
      cluster.y - 9,
      Math.max(cluster.x + 2, cluster.x + s0 * 29),
      cluster.y + 9);
    const col = lit ? C_CHG : C_DIM;
    const s = cluster.dir;   // -1 = point left, 1 = point right
    for (let i = 0; i < 3; i++) {
      const x = cluster.x + s * i * 10;
      g.setColor(col).drawLine(x, cluster.y - 8, x + s * 8, cluster.y)
       .drawLine(x, cluster.y + 8, x + s * 8, cluster.y);
      if (lit) g.drawLine(x, cluster.y - 7, x + s * 7, cluster.y)
                .drawLine(x, cluster.y + 7, x + s * 7, cluster.y);
    }
  }

  function drawTrend() {
    drawChevrons(CHV_L, trend < 0);
    drawChevrons(CHV_R, trend > 0);
  }

  // Flash the newly-active cluster a few times, then hold steady lit.
  // Skipped entirely while locked -- a locked screen only ever gets the
  // final static state, never a running animation.
  function animateTrend(newTrend) {
    const cluster = newTrend < 0 ? CHV_L : CHV_R;
    if (locked || newTrend === 0) { trend = newTrend; drawTrend(); return; }
    if (chevBlink) clearInterval(chevBlink);
    let n = 0, on = false;
    chevBlink = setInterval(() => {
      drawChevrons(cluster, on);
      on = !on;
      if (++n >= 6) {
        clearInterval(chevBlink);
        chevBlink = undefined;
        trend = newTrend;
        drawTrend();
      }
    }, 250);
  }

  // ======== mini pods ========
  function ppt(p, a, r) {
    const rad = a * Math.PI / 180;
    return [p.x + r * Math.cos(rad), p.y - r * Math.sin(rad)];
  }
  const podAngle = (frac) => PA0 - frac * (PA0 - PA1);

  function drawPodChrome(p) {
    let poly = [p.x, p.y];
    for (let a = PA0 + 10; a >= PA1 - 10; a -= 8) {
      const q = ppt(p, a, PR);
      poly.push(q[0], q[1]);
    }
    g.setColor(C_FAN).fillPoly(poly);
    g.setColor(C_SCALE).drawPoly(poly.slice(2), false);
    let q = ppt(p, PA0 + 10, PR); g.drawLine(p.x, p.y, q[0], q[1]);
    q = ppt(p, PA1 - 10, PR);     g.drawLine(p.x, p.y, q[0], q[1]);
    for (let i = 0; i <= 4; i++) {
      const a = podAngle(i / 4);
      const q1 = ppt(p, a, 22), q2 = ppt(p, a, 28);
      g.drawLine(q1[0], q1[1], q2[0], q2[1]);
    }
    g.setColor(C_FAN).fillRect(p.x - 22, p.y + 4, p.x + 22, p.y + 14);
    g.setColor(C_SCALE).setFont("6x8", 1).setFontAlign(0, 0)
     .drawString(p.label, p.x, p.y + 9);
  }

  function drawPodNeedle(p, frac, col) {
    const rad = podAngle(frac) * Math.PI / 180;
    const dx = Math.cos(rad), dy = -Math.sin(rad);
    const px = -dy * 2, py = dx * 2;
    const bx = p.x + 11 * dx, by = p.y + 11 * dy;
    g.setColor(col).fillPoly([
      bx + px, by + py,
      bx - px, by - py,
      p.x + 21 * dx, p.y + 21 * dy
    ]);
  }

  function updatePod(i, frac, valStr, ndlCol) {
    const p = PODS[i];
    if (lastNdl[i] !== null) drawPodNeedle(p, lastNdl[i], C_FAN);
    g.setColor(C_FAN).fillRect(p.x - 14, p.y - 15, p.x + 14, p.y - 7);
    g.setColor(C_SCALE).setFont("6x8", 1).setFontAlign(0, 0)
     .drawString(valStr, p.x, p.y - 11);
    drawPodNeedle(p, frac, ndlCol);
    lastNdl[i] = frac;
  }

  // ======== odometer (steps <-> distance trip meter) ========
  function drawOdoChrome() {
    g.setColor(C_FAN).fillRect(ODO.x1, ODO.y1, ODO.x2, ODO.y2);
    g.setColor(C_SCALE).drawRect(ODO.x1, ODO.y1, ODO.x2, ODO.y2);
    for (let i = 1; i < 5; i++)
      g.drawLine(ODO.x1 + 9 * i, ODO.y1 + 1, ODO.x1 + 9 * i, ODO.y2 - 1);
    drawOdoTag();
  }

  function drawOdoTag() {
    g.setColor(C_FAN).fillRect(70, 22, 106, 30);
    g.setColor(C_SCALE).setFont("6x8", 1).setFontAlign(0, 0)
     .drawString(odoMode ? "DIST" : "STEPS", 88, 26);
  }

  function odoString(steps) {
    if (!odoMode) return ("00000" + Math.min(steps, 99999)).substr(-5);
    let d = locale.distance(steps * 0.75, 1);   // ~0.75 m stride
    if (d.length > 5) d = d.replace(/\.\d+/, "");
    if (d.length > 5) d = d.substr(0, 5);
    return ("     " + d).substr(-5);
  }

  function updateOdo(steps) {
    const s = odoString(steps);
    g.setFont("6x8", 1).setFontAlign(0, 0);
    for (let i = 0; i < 5; i++) {
      g.setColor(C_FAN).fillRect(ODO.x1 + 1 + 9 * i, ODO.y1 + 2,
                                 ODO.x1 + 8 + 9 * i, ODO.y2 - 2);
      g.setColor(C_SCALE).drawString(s[i], ODO.x1 + 5 + 9 * i, 12);
    }
  }

  // ======== data sources ========
  function readHealth() {
    let bpm = 0, steps = 0;
    try {
      const d = Bangle.getHealthStatus("day");
      steps = d.steps || 0;
      const l = Bangle.getHealthStatus("last");
      if (l.bpm && l.bpmConfidence > 0) bpm = l.bpm;
    } catch (e) {}
    return { bpm: bpm, steps: steps };
  }

  function updatePods() {
    const bat = E.getBattery();
    const chg = Bangle.isCharging();
    const bKey = bat + (chg ? 1000 : 0);
    if (bKey !== lastVals[0]) {
      lastVals[0] = bKey;
      updatePod(0, bat / 100, "" + bat, chg ? C_CHG : C_NDL);
    }
    if (!hrmOn) {
      const h = readHealth();
      if (h.bpm !== lastVals[1]) {
        lastVals[1] = h.bpm;
        const frac = h.bpm ? Math.min(Math.max((h.bpm - 40) / 140, 0), 1) : 0;
        updatePod(1, frac, h.bpm ? "" + h.bpm : "--", C_NDL);
      }
      if (h.steps !== lastSteps) {
        lastSteps = h.steps;
        updateOdo(h.steps);
      }
    }
  }

  // ======== barometric pressure trend ========
  // Wakes the barometer briefly every 15 min, compares against a reading
  // from roughly an hour ago, then sleeps it again -- same low-duty-cycle
  // pattern as the HRM, just on a much slower clock.
  function onPressure(d) {
    Bangle.removeListener('pressure', onPressure);
    Bangle.setBarometerPower(0, "retrogauge");
    if (!d || !d.pressure) return;
    const now = Date.now();
    const prev = cfg.baroPrev;
    if (prev && (now - prev.t) >= 45 * 60000) {
      const delta = d.pressure - prev.p;
      const nt = (delta > 0.5) ? 1 : (delta < -0.5) ? -1 : 0;
      if (nt !== trend) animateTrend(nt);
    }
    if (!prev || (now - prev.t) >= 60 * 60000) {
      cfg.baroPrev = { p: d.pressure, t: now };
      cfg.trend = trend;
      saveCfg();
    }
  }

  function sampleBaro() {
    if (cfg.baro === false) return;
    try {
      Bangle.setBarometerPower(1, "retrogauge");
      Bangle.on('pressure', onPressure);
    } catch (e) {}
  }

  // ======== on-demand live heart rate (tap BPM pod) ========
  function liveHRM() {
    if (hrmOn) return stopHRM(true);
    hrmOn = true;
    Bangle.setHRMPower(1, "retrogauge");
    lastVals[1] = null;
    updatePod(1, 0, "...", C_CHG);
    hrmTimeout = setTimeout(() => stopHRM(true), 20000);
  }
  function onHRM(h) {
    if (!hrmOn) return;
    const frac = Math.min(Math.max((h.bpm - 40) / 140, 0), 1);
    updatePod(1, frac, "" + h.bpm, C_CHG);
    if (h.confidence >= 80) {
      Bangle.buzz(60);
      stopHRM(false);          // keep the locked reading on screen
    }
  }
  function stopHRM(revert) {
    if (!hrmOn) return;
    hrmOn = false;
    if (hrmTimeout) { clearTimeout(hrmTimeout); hrmTimeout = undefined; }
    Bangle.setHRMPower(0, "retrogauge");
    if (revert) { lastVals[1] = null; updatePods(); }
  }

  // ======== static dial ========
  function drawFace() {
    g.setColor(C_DIAL).fillRect(0, 0, 175, 175);
    g.setColor(C_RIB);
    for (let y = 3; y < PANEL_Y; y += 4) g.drawLine(0, y, 175, y);

    let poly = [CX, CY];
    for (let a = FA0; a >= FA1; a -= 4) {
      const p = pt(a, R_FAN);
      poly.push(p[0], p[1]);
    }
    g.setColor(C_FAN).fillPoly(poly);
    g.setColor(C_SCALE).drawPoly(poly.slice(2), false);
    let p = pt(FA0, R_FAN); g.drawLine(CX, CY, p[0], p[1]);
    p = pt(FA1, R_FAN);     g.drawLine(CX, CY, p[0], p[1]);

    for (let m = 0; m <= 60; m += 2) {
      const a = angleFor(m);
      const r2 = (m % 10 === 0) ? R_T1 + 14 : ((m % 10 === 5) ? R_T1 + 10 : R_T1 + 7);
      const p1 = pt(a, R_T1), p2 = pt(a, r2);
      g.drawLine(p1[0], p1[1], p2[0], p2[1]);
      if (m % 10 === 0) g.drawLine(p1[0] + 1, p1[1], p2[0] + 1, p2[1]);
    }
    g.setFont("6x8", 1).setFontAlign(0, 0);
    for (let m = 0; m <= 60; m += 10) {
      const n = pt(angleFor(m), R_NUM);
      g.drawString(m, n[0], n[1]);
    }

    drawPodChrome(PODS[0]);
    drawPodChrome(PODS[1]);
    drawOdoChrome();
  }

  // ======== lower plate + jump hour ========
  function drawHour(now) {
    g.setColor(C_FAN).fillRect(0, PANEL_Y, 175, 175);
    drawTrend();
    g.setColor(C_SCALE).drawCircle(HCX, HCY, HR).drawCircle(HCX, HCY, HR + 1);
    g.setColor(C_DISC).fillCircle(HCX, HCY, HR - 3);
    const hStr = locale.time(now, 1).split(":")[0].trim();
    g.setColor(C_HOUR).setFont("Vector", 26).setFontAlign(0, 0)
     .drawString(hStr, HCX, HCY + 1);
    if (+hStr !== now.getHours()) {
      g.setColor(C_SCALE).setFont("6x8", 1).setFontAlign(-1, 0)
       .drawString(locale.meridian(now), HCX + HR + 8, HCY);
    }
  }

  // Tap the hour disc: it briefly shows the date, then flips back.
  function datePeek() {
    if (peekTimer) clearTimeout(peekTimer);
    const now = new Date();
    g.setColor(C_DISC).fillCircle(HCX, HCY, HR - 3);
    g.setColor(C_HOUR).setFont("6x8", 1).setFontAlign(0, 0)
     .drawString(locale.dow(now, 1).substr(0, 3).toUpperCase(), HCX, HCY - 8);
    g.setFont("Vector", 18).drawString(now.getDate(), HCX, HCY + 7);
    peekTimer = setTimeout(() => {
      peekTimer = undefined;
      drawHour(new Date());
    }, 3000);
  }

  // ======== flyback ========
  function flyback(now) {
    function land() {
      drawNeedle(0, C_NDL);
      lastHour = null;
      drawHour(now);
      if (cfg.buzz) Bangle.buzz(80);
    }
    if (cfg.fly === false) return land();
    if (anim) clearInterval(anim);
    let v = 60;
    drawNeedle(v, C_NDL);
    anim = setInterval(() => {
      drawNeedle(v, C_FAN);
      v -= 6;
      if (v <= 0) {
        clearInterval(anim);
        anim = undefined;
        land();
      } else {
        drawNeedle(v, C_NDL);
      }
    }, 30);
  }

  // Tap the main gauge: replay the flyback, then return to the real time.
  function demoFly() {
    if (anim || demoTimer || lastMin < 0) return;
    drawNeedle(lastMin, C_FAN);
    let v = 60;
    drawNeedle(v, C_NDL);
    anim = setInterval(() => {
      drawNeedle(v, C_FAN);
      v -= 6;
      if (v <= 0) {
        clearInterval(anim);
        anim = undefined;
        drawNeedle(0, C_NDL);
        Bangle.buzz(40);
        demoTimer = setTimeout(() => {
          demoTimer = undefined;
          drawNeedle(0, C_FAN);
          drawNeedle(lastMin, C_NDL);
        }, 700);
      } else {
        drawNeedle(v, C_NDL);
      }
    }, 30);
  }

  // ======== widget bar reveal (swipe down / up) ========
  let widsVisible = false, widTimer;

  function redrawTop() {
    g.setColor(C_DIAL).fillRect(0, 0, 175, 23);
    g.setColor(C_RIB);
    for (let y = 3; y < 24; y += 4) g.drawLine(0, y, 175, y);
    drawPodChrome(PODS[0]);
    drawPodChrome(PODS[1]);
    drawOdoChrome();
    lastVals = [null, null]; lastNdl = [null, null]; lastSteps = null;
    updatePods();
  }

  function reveal() {
    if (widsVisible) return;
    widsVisible = true;
    require("widget_utils").show();
    Bangle.drawWidgets();
    const ms = (typeof cfg.peek === "number") ? cfg.peek : 2000;
    if (ms > 0) widTimer = setTimeout(dismiss, ms);
  }

  function dismiss() {
    if (widTimer) { clearTimeout(widTimer); widTimer = undefined; }
    if (!widsVisible) return;
    widsVisible = false;
    require("widget_utils").hide();
    redrawTop();
  }

  // ======== touch + swipe controls ========
  function tripToggle() {
    odoMode = 1 - odoMode;
    cfg.odo = odoMode;
    saveCfg();
    drawOdoTag();
    lastSteps = null;
    updatePods();
  }

  function onTouch(n, e) {
    if (!e) return;
    const dx = e.x - HCX, dy = e.y - HCY;
    if (dx * dx + dy * dy < 34 * 34) return datePeek();      // hour disc
    if (e.y < 40 && e.x > 58 && e.x < 118) return tripToggle(); // odometer
    if (e.y < 85 && e.x < 64) return;                        // FUEL: no action
    if (e.y < 85 && e.x > 112) return liveHRM();             // BPM pod
    if (e.y < PANEL_Y) return demoFly();                     // main gauge
  }

  function onSwipe(lr, ud) {
    if (ud > 0) return reveal();
    if (ud < 0) return dismiss();
    if (!lr) return;
    if (widsVisible) {          // fullDraw repaints the top anyway
      if (widTimer) { clearTimeout(widTimer); widTimer = undefined; }
      require("widget_utils").hide();
      widsVisible = false;
    }
    cfg.theme = ((cfg.theme || 0) + lr + THEMES.length) % THEMES.length;
    saveCfg();
    applyTheme();
    fullDraw();
  }

  // ======== redraw plumbing ========
  function drawClock() {
    const now = new Date();
    const m = now.getMinutes();
    const hStr = locale.time(now, 1).split(":")[0].trim();
    updatePods();
    if (m === lastMin && hStr === lastHour) return;
    const wasEnd = (lastMin === 59);
    if (lastMin >= 0) drawNeedle(lastMin, C_FAN);
    lastMin = m;
    if (m === 0 && wasEnd) {
      flyback(now);
    } else {
      drawNeedle(m, C_NDL);
      if (hStr !== lastHour) { lastHour = hStr; drawHour(now); }
    }
  }

  function queueDraw() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      drawClock();
      queueDraw();
    }, 60000 - (Date.now() % 60000));
  }

  function fullDraw() {
    drawFace();
    lastMin = -1; lastHour = null;
    lastVals = [null, null]; lastNdl = [null, null]; lastSteps = null;
    drawClock();
  }

  function onLcd(on) { if (on) fullDraw(); }
  function onCharge() { updatePods(); }
  function onLock(isLocked) {
    locked = isLocked;
    if (locked && chevBlink) {         // freeze mid-flash -> final state
      clearInterval(chevBlink);
      chevBlink = undefined;
      drawTrend();
    }
  }

  applyTheme();
  g.clear();

  Bangle.setUI({
    mode: "clock",
    remove: () => {
      if (timer) clearTimeout(timer);
      if (anim) clearInterval(anim);
      if (demoTimer) clearTimeout(demoTimer);
      if (peekTimer) clearTimeout(peekTimer);
      if (widTimer) clearTimeout(widTimer);
      if (baroTimer) clearInterval(baroTimer);
      if (chevBlink) clearInterval(chevBlink);
      Bangle.setBarometerPower(0, "retrogauge");
      Bangle.removeListener('pressure', onPressure);
      Bangle.removeListener('lock', onLock);
      stopHRM(false);                      // powers the sensor down
      Bangle.removeListener('lcdPower', onLcd);
      Bangle.removeListener('charging', onCharge);
      Bangle.removeListener('touch', onTouch);
      Bangle.removeListener('swipe', onSwipe);
      Bangle.removeListener('HRM', onHRM);
      require("widget_utils").show();
    }
  });

  Bangle.loadWidgets();
  Bangle.drawWidgets();              // lay widgets out once (sets their x/y)
  require("widget_utils").hide();    // then stub their draws: nothing can
                                     // repaint the bar behind our back
  fullDraw();
  queueDraw();
  Bangle.on('lcdPower', onLcd);
  Bangle.on('charging', onCharge);
  Bangle.on('touch', onTouch);
  Bangle.on('swipe', onSwipe);
  Bangle.on('HRM', onHRM);
  Bangle.on('lock', onLock);
  setTimeout(sampleBaro, 5000);              // first sample shortly after boot
  baroTimer = setInterval(sampleBaro, 15 * 60000);
}
