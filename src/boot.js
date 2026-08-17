/* ==========================================================================
   The identifying animation for webhost.systems — SHELL.md §8.

   The subject the shell assigns this surface is "a machine booting somewhere
   that is not ours". Nothing here boots anywhere, so §8.3 applies literally:
   when the honest answer is that nothing runs yet, ANIMATE THE SPECIFICATION.
   A structure assembling is truthful; a dashboard is not, and a fake dashboard
   is this page's entire history.

   So what is drawn is a machine being DRAFTED rather than started: a chassis
   plotted stroke by stroke, its slots filling one at a time as the parts that
   exist are placed — and the last slot, the one the whole thing is for, never
   fills. It sits dashed with a caret blinking in it, and then the drawing is
   erased and drafted again.

   IT RENDERS NO DATA AND ASSERTS NOTHING. §8.1 rule 2 is not negotiable and it
   is written in blood: gpscoord.com published `for (let i = 0; i < 12; i++)` —
   the loop bound of a decorative animation — beside the words "Active
   Pathfinders", for months.

   So this file takes NO input from the document and writes NOTHING back into
   it. It queries exactly one element, its own canvas, and touches nothing else.
   Its counts are deliberately wrong about this repository: it drafts five slots
   and this surface does not have five of anything it publishes. If a constant
   here ever collides with a figure on the page, launch-gate.mjs refuses the
   build — and the fix is to change THIS FILE, never the page. Decoration
   yields.
   ========================================================================== */
(function () {
  var host = document.querySelector("[data-identity-animation]");
  if (!host || !host.getContext) return;
  var ctx = host.getContext("2d");
  if (!ctx) return;

  var FPS = 22;
  var FRAME = 1000 / FPS;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");

  /* --- palette, read from nothing; these are literals on purpose ---------- */
  var ACC = "139,125,255";
  var DIM = "232,233,242";
  var OPEN = "245,196,81";

  /* --- the machine being drafted ----------------------------------------
     SLOTS is the number of rows in the chassis. The last one is the hole.  */
  var SLOTS = 5;
  /* The chassis plots FAST — a slow open leaves the panel looking empty for the
     first seconds after load, and an empty panel reads as a broken one. The
     finished draft is what is held. */
  var PLOT = 40;      /* frames to plot the chassis outline                 */
  var PER = 34;       /* frames each filled slot takes to slide in          */
  var HOLD = 120;     /* frames the finished draft is held before erasing   */
  var ERASE = 26;     /* frames the erase sweep takes                       */

  var W = 0, H = 0, raf = 0, last = 0, t = 0;

  function rrect(x, y, w, h, r) {
    if (r > h * 0.5) r = h * 0.5;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /* The chassis outline, plotted as a fraction of its own perimeter so the
     pen appears to travel it rather than the rectangle appearing at once. */
  function chassis(x, y, w, h, p) {
    var per = (w + h) * 2;
    var run = per * p;
    var seg = [w, h, w, h];
    var pt = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    ctx.beginPath();
    ctx.moveTo(pt[0][0], pt[0][1]);
    for (var i = 0; i < 4; i++) {
      if (run <= 0) break;
      var d = Math.min(run, seg[i]);
      var a = pt[i], b = pt[(i + 1) % 4];
      ctx.lineTo(a[0] + (b[0] - a[0]) * (d / seg[i]), a[1] + (b[1] - a[1]) * (d / seg[i]));
      run -= d;
    }
    ctx.stroke();
  }

  function draw(frame) {
    ctx.clearRect(0, 0, W, H);

    var padX = W * 0.09;
    var padY = H * 0.14;
    var cw = W - padX * 2;
    var ch = H - padY * 2;
    if (cw < 40 || ch < 40) return;

    var cycle = PLOT + PER * SLOTS + HOLD + ERASE;
    var f = frame % cycle;

    /* 1. the chassis is plotted */
    var plotted = Math.min(1, f / PLOT);
    var wipe = f > cycle - ERASE ? (f - (cycle - ERASE)) / ERASE : 0;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(" + ACC + "," + (0.5 * (1 - wipe)) + ")";
    chassis(padX, padY, cw, ch, plotted * (1 - wipe));
    ctx.setLineDash([]);

    /* 2. the slots. Every one but the last fills; the last is the hole. */
    var rowH = ch / SLOTS;
    var barH = Math.max(3.4, rowH * 0.34);
    var inset = cw * 0.08;
    for (var i = 0; i < SLOTS; i++) {
      var y = padY + rowH * i + rowH * 0.5;
      var open = i === SLOTS - 1;
      var start = PLOT + PER * i;
      var g = Math.max(0, Math.min(1, (f - start) / PER));
      if (g <= 0) continue;
      var a = (1 - wipe);

      /* the label stub on the left of every row */
      ctx.fillStyle = "rgba(" + DIM + "," + (0.16 * a) + ")";
      rrect(padX + inset, y - barH * 0.5, cw * 0.17, barH, barH * 0.5);
      ctx.fill();

      var bx = padX + inset + cw * 0.21;
      var bw = cw * 0.62;

      if (open) {
        /* the hole: a dashed empty slot with a caret blinking inside it */
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(" + OPEN + "," + (0.55 * g * a) + ")";
        rrect(bx, y - barH * 0.9, bw, barH * 1.8, 3);
        ctx.stroke();
        ctx.setLineDash([]);
        if (Math.floor(frame / 15) % 2 === 0) {
          ctx.fillStyle = "rgba(" + OPEN + "," + (0.8 * g * a) + ")";
          ctx.fillRect(bx + 7, y - barH * 0.5, 2, barH);
        }
      } else {
        /* a placed part: the bar slides in from the left as it fills */
        ctx.fillStyle = "rgba(" + DIM + "," + (0.3 * a) + ")";
        rrect(bx, y - barH * 0.5, bw * g, barH, barH * 0.5);
        ctx.fill();
        /* and leaves an accent underscore behind it */
        ctx.fillStyle = "rgba(" + ACC + "," + (0.7 * g * a) + ")";
        ctx.fillRect(bx, y + barH * 0.85, bw * g * 0.34, 1.4);
      }
    }
  }

  function size() {
    var r = host.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    W = Math.max(r.width, 140);
    H = Math.max(r.height, 100);
    host.width = Math.round(W * dpr);
    host.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* prefers-reduced-motion: one frame of the finished draft, and stop. */
  function still() { size(); draw(PLOT + PER * SLOTS + 20); }

  function frame(now) {
    raf = window.requestAnimationFrame(frame);
    /* Stop when the tab is hidden, and when the hero has scrolled away.
       IntersectionObserver is NOT used at all — it never fires in a
       non-compositing renderer, and an animation that never starts reads as a
       broken page. SHELL.md §6. */
    if (document.hidden) return;
    if (now - last < FRAME) return;
    last = now;
    var r = host.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    t++;
    draw(t);
  }

  function boot() {
    if (reduce && reduce.matches) { still(); return; }
    size();
    if (raf) window.cancelAnimationFrame(raf);
    raf = window.requestAnimationFrame(frame);
  }

  var timer = 0;
  window.addEventListener("resize", function () {
    window.clearTimeout(timer);
    timer = window.setTimeout(boot, 160);
  });
  if (reduce) reduce.onchange = boot;
  boot();
})();
