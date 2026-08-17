(function () {
var host = document.querySelector("[data-identity-animation]");
if (!host || !host.getContext) return;
var ctx = host.getContext("2d");
if (!ctx) return;
var FPS = 22;
var FRAME = 1000 / FPS;
var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)");
var ACC = "139,125,255";
var DIM = "232,233,242";
var OPEN = "245,196,81";
var SLOTS = 5;
var PLOT = 40;
var PER = 34;
var HOLD = 120;
var ERASE = 26;
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
var plotted = Math.min(1, f / PLOT);
var wipe = f > cycle - ERASE ? (f - (cycle - ERASE)) / ERASE : 0;
ctx.lineWidth = 1.2;
ctx.setLineDash([4, 4]);
ctx.strokeStyle = "rgba(" + ACC + "," + (0.5 * (1 - wipe)) + ")";
chassis(padX, padY, cw, ch, plotted * (1 - wipe));
ctx.setLineDash([]);
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
ctx.fillStyle = "rgba(" + DIM + "," + (0.16 * a) + ")";
rrect(padX + inset, y - barH * 0.5, cw * 0.17, barH, barH * 0.5);
ctx.fill();
var bx = padX + inset + cw * 0.21;
var bw = cw * 0.62;
if (open) {
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
ctx.fillStyle = "rgba(" + DIM + "," + (0.3 * a) + ")";
rrect(bx, y - barH * 0.5, bw * g, barH, barH * 0.5);
ctx.fill();
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
function still() { size(); draw(PLOT + PER * SLOTS + 20); }
function frame(now) {
raf = window.requestAnimationFrame(frame);
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
