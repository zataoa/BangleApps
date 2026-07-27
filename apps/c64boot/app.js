{
  // C64 BOOT CLOCK - Bangle.js 2
  // Everything lives in this block so it de-allocates cleanly on fast load.

  const locale = require("locale");

  // ---- config -------------------------------------------------------------
  const cfg = require('Storage').readJSON('c64boot.json', 1) || {};
  const s = {
    stat:  (cfg.stat === "battery" || cfg.stat === "steps") ? cfg.stat : "bytes",
    blink: cfg.blink === true      // off by default: blinking costs 1 redraw/sec
  };

  // ---- palette ------------------------------------------------------------
  // Nearest 8-colour matches to the C64 boot screen (light blue on dark blue).
  const FG = 0x07FF;   // cyan  -> C64 light blue (text + border)
  const BG = 0x001F;   // blue  -> C64 dark blue (screen)

  // ---- layout -------------------------------------------------------------
  const BORDER = 6;          // C64 border thickness
  const L      = 10;         // left text margin
  const R      = 169;        // right edge of the inner screen
  const STAT_Y = 52;         // status / bytes-free line
  const TIME_Y = 86;         // top of the big time
  const MAXH   = 8 * 4;      // tallest the time can be (font 6x8 at scale 4)

  let timer;                 // minute timer
  let blinkTimer;            // cursor timer
  let cursorOn = true;
  let timeStr  = "";
  let timeSize = 4;

  // ---- the double-duty status line ----------------------------------------
  function steps() {
    // getHealthStatus may not exist on very old firmware - fail soft.
    try { return Bangle.getHealthStatus("day").steps | 0; } catch (e) { return 0; }
  }

  function statLine() {
    if (s.stat === "battery") return E.getBattery() + " PERCENT POWER FREE";
    if (s.stat === "steps")   return steps() + " STEPS TAKEN TODAY";
    return "38911 BASIC BYTES FREE";
  }

  // ---- drawing ------------------------------------------------------------
  // Static chrome is drawn once; only the time (and the stat) repaint later.
  function drawChrome() {
    g.reset();
    g.setColor(FG).fillRect(0, 0, 175, 175);                       // border
    g.setColor(BG).fillRect(BORDER, BORDER, R, R);                 // screen
    g.setColor(FG).setBgColor(BG).setFont("6x8", 1);

    g.setFontAlign(0, -1);                                         // centred banner
    g.drawString("**** COMMODORE 64", 88, 14);
    g.drawString("BASIC V2 ****", 88, 24);

    g.setFontAlign(-1, -1);                                        // left-aligned body
    g.drawString("64K RAM SYSTEM", L, 42);
    g.drawString("READY.", L, 70);

    drawStat();
  }

  function drawStat() {
    g.reset().setColor(FG).setBgColor(BG).setFont("6x8", 1).setFontAlign(-1, -1);
    g.clearRect(L, STAT_Y, R, STAT_Y + 7);
    g.drawString(statLine(), L, STAT_Y);
  }

  function drawTime() {
    timeStr = locale.time(new Date(), 1);   // honours the user's 12/24h setting

    // Shrink to fit: the string plus one cursor cell must clear the right edge.
    timeSize = 4;
    while (timeSize > 1 && (timeStr.length + 1) * 6 * timeSize > (R - L)) timeSize--;

    g.reset().setColor(FG).setBgColor(BG);
    g.clearRect(L, TIME_Y, R, TIME_Y + MAXH - 1);
    g.setFont("6x8", timeSize).setFontAlign(-1, -1);
    g.drawString(timeStr, L, TIME_Y);
    drawCursor();
  }

  function drawCursor() {
    const cw = 6 * timeSize, ch = 8 * timeSize;
    const x  = L + timeStr.length * cw;
    g.setColor(cursorOn ? FG : BG).fillRect(x, TIME_Y, x + cw - 1, TIME_Y + ch - 1);
  }

  // ---- timing -------------------------------------------------------------
  // Aligned to the top of the next minute: ~1 month of battery.
  function queueDraw() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      drawTime();
      if (s.stat !== "bytes") drawStat();   // battery/steps move, so refresh them
      queueDraw();
    }, 60000 - (Date.now() % 60000));
  }

  function startBlink() {
    if (!s.blink) return;
    blinkTimer = setInterval(() => {
      cursorOn = !cursorOn;
      drawCursor();
    }, 1000);
  }

  // Repaint on wake - the screen may have been powered down mid-minute.
  function onLcd(on) { if (on) { drawChrome(); drawTime(); } }
  Bangle.on('lcdPower', onLcd);

  // ---- start --------------------------------------------------------------
  g.clear();
  drawChrome();
  drawTime();
  queueDraw();
  startBlink();

  // Clocks are fast-loaded, so 'kill' may never fire - free everything here.
  Bangle.setUI({
    mode: "clock",
    remove: () => {
      if (timer) clearTimeout(timer);
      if (blinkTimer) clearInterval(blinkTimer);
      Bangle.removeListener('lcdPower', onLcd);
    }
  });
}
