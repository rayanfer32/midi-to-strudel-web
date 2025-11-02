/* ---------- helpers ---------- */
const NOTE_NAMES = [
  "c",
  "c#",
  "d",
  "d#",
  "e",
  "f",
  "f#",
  "g",
  "g#",
  "a",
  "a#",
  "b",
];
function noteNumToStr(n) {
  return NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);
}

function quantizeTime(t, cycleStart, cycleLen, notesPerBar) {
  const rel = (t - cycleStart) / cycleLen;
  const q = Math.round(rel * notesPerBar) / notesPerBar;
  return Math.min(q, 1 - 1e-9);
}

function simplifySubdivisions(arr) {
  let cur = arr;
  while (cur.length % 2 === 0) {
    const ok = cur.every((_, i) => (i % 2 === 1 ? cur[i] === "-" : true));
    if (!ok) break;
    cur = cur.filter((_, i) => i % 2 === 0);
  }
  return cur;
}

/* ---------- core ---------- */
function midiToStrudel(arrayBuffer, opts) {
  const midi = new Midi(arrayBuffer); // <- @tonejs/midi
  const ppq = midi.header.ppq;
  const bpm = midi.header.tempos.length ? midi.header.tempos[0].bpm : 120;
  const cycleLen = (60 / bpm) * 4; // 1 cycle = 4 beats

  /* collect note_on events */
  const events = {}; // trackIndex -> [{time,note},...]
  midi.tracks.forEach((track, idx) => {
    if (!track.notes.length) return;
    events[idx] = track.notes.map((n) => ({
      time: n.time,
      note: noteNumToStr(n.midi),
    }));
  });

  /* build bars */
  const tracks = [];
  Object.keys(events)
    .sort((a, b) => a - b)
    .forEach((trackIdx) => {
      const evs = events[trackIdx];
      /* push notes >95% into next cycle */
      const adj = evs.map((e) => {
        const rel = (e.time % cycleLen) / cycleLen;
        return rel > 0.95
          ? { ...e, time: Math.ceil(e.time / cycleLen) * cycleLen }
          : e;
      });
      const maxT = Math.max(...adj.map((e) => e.time));
      const numCycles =
        opts.barLimit > 0
          ? Math.min(Math.floor(maxT / cycleLen) + 1, opts.barLimit)
          : Math.floor(maxT / cycleLen) + 1;
      const bars = [];
      for (let c = 0; c < numCycles; c++) {
        const start = c * cycleLen,
          end = start + cycleLen;
        const inCycle = adj.filter((e) => e.time >= start && e.time < end);
        if (!inCycle.length) {
          bars.push("-");
          continue;
        }

        if (opts.flat) {
          const notes = inCycle.map((e) => e.note);
          bars.push(notes.length === 1 ? notes[0] : `[${notes.join(" ")}]`);
        } else {
          const groups = {}; // pos -> [notes]
          inCycle.forEach((e) => {
            const pos = quantizeTime(e.time, start, cycleLen, opts.notesPerBar);
            const key = Math.round(pos * opts.notesPerBar) / opts.notesPerBar;
            (groups[key] || (groups[key] = [])).push(e.note);
          });
          const subdiv = Array(opts.notesPerBar).fill("-");
          Object.keys(groups)
            .sort((a, b) => a - b)
            .forEach((k) => {
              const idx = Math.round(parseFloat(k) * opts.notesPerBar);
              if (idx < opts.notesPerBar) {
                const g = groups[k];
                subdiv[idx] = g.length === 1 ? g[0] : `[${g.join(",")}]`;
              }
            });
          const simp = simplifySubdivisions(subdiv);
          const bar = simp.length === 1 ? simp[0] : `[${simp.join(" ")}]`;
          bars.push(
            bar === "[" + Array(opts.notesPerBar).fill("-").join(" ") + "]"
              ? "-"
              : bar
          );
        }
      }
      if (bars.length) tracks.push(bars);
    });

  /* build text */
  const indent = (n) => " ".repeat(n);
  const out = [`setcpm(${Math.round(bpm)}/4)`];
  tracks.forEach((bars) => {
    out.push("$: note(`<");
    for (let i = 0; i < bars.length; i += 4) {
      const chunk = bars.slice(i, i + 4).join(" ");
      out.push(`${indent(opts.tabSize * 2)}${chunk}`);
    }
    out[out.length - 1] += ">`)";
  });
  return out.join("\n");
}

/* ---------- UI ---------- */
const $ = (q) => document.querySelector(q);
function run(file) {
  const opts = {
    barLimit: parseInt($("#barLimit").value) || 0,
    notesPerBar: parseInt($("#notesPerBar").value) || 64,
    flat: $("#flat").checked,
    tabSize: parseInt($("#tabSize").value) || 2,
  };
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      $("#output").value = midiToStrudel(e.target.result, opts);
    } catch (err) {
      $("#output").value = "Error: " + err.message;
    }
  };
  reader.readAsArrayBuffer(file);
}
$("#file").addEventListener(
  "change",
  (e) => e.target.files[0] && run(e.target.files[0])
);
/* drag & drop */
["dragenter", "dragover", "drop"].forEach((ev) =>
  window.addEventListener(
    ev,
    (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    false
  )
);
window.addEventListener(
  "drop",
  (e) => {
    const f = [...e.dataTransfer.files].find((x) => /\.mid$/i.test(x.name));
    if (f) {
      $("#file").files = e.dataTransfer.files;
      run(f);
    }
  },
  false
);
