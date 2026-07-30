(function(back) {
  let s = require('Storage').readJSON('retrogauge.json', 1) || {};
  const themes = ["Mint", "Silver", "Midnight", "Navy", "Red"];
  const peeks = [1000, 2000, 4000, 0];
  const peekNames = ["1s", "2s", "4s", "Stay"];
  if (typeof s.theme !== "number") s.theme = 0;
  if (typeof s.odo !== "number") s.odo = 0;
  if (typeof s.peek !== "number") s.peek = 2000;
  if (typeof s.fly !== "boolean") s.fly = true;
  if (typeof s.buzz !== "boolean") s.buzz = false;
  if (typeof s.baro !== "boolean") s.baro = true;
  function save(k, v) {
    s[k] = v;
    require('Storage').writeJSON('retrogauge.json', s);
  }
  E.showMenu({
    "": { "title": "Retro Gauge" },
    "< Back": back,
    "Theme": {
      value: s.theme, min: 0, max: themes.length - 1,
      format: v => themes[v],
      onchange: v => save("theme", v)
    },
    "Odometer": {
      value: s.odo, min: 0, max: 1,
      format: v => v ? "Distance" : "Steps",
      onchange: v => save("odo", v)
    },
    "Widget peek": {
      value: Math.max(0, peeks.indexOf(s.peek)), min: 0, max: 3,
      format: v => peekNames[v],
      onchange: v => save("peek", peeks[v])
    },
    "Flyback anim": { value: s.fly, onchange: v => save("fly", v) },
    "Hour buzz":    { value: s.buzz, onchange: v => save("buzz", v) },
    "Pressure trend": { value: s.baro, onchange: v => save("baro", v) }
  });
})
