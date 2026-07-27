(function(back) {
  const FILE = 'c64boot.json';
  const STATS = ["bytes", "battery", "steps"];

  let s = require('Storage').readJSON(FILE, 1) || {};
  if (STATS.indexOf(s.stat) < 0) s.stat = "bytes";
  if (typeof s.blink !== "boolean") s.blink = false;

  function save() { require('Storage').writeJSON(FILE, s); }

  E.showMenu({
    "": { "title": "C64 Boot" },
    "< Back": back,
    "Status line": {
      value: STATS.indexOf(s.stat),
      min: 0, max: STATS.length - 1, wrap: true,
      format: v => STATS[v],
      onchange: v => { s.stat = STATS[v]; save(); }
    },
    "Blink cursor": {
      value: s.blink,
      onchange: v => { s.blink = v; save(); }
    }
  });
})
