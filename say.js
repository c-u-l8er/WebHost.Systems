(function () {
var form = document.querySelector("form.say");
if (!form || !window.fetch || !window.FormData) return;
var msg = form.querySelector(".say-msg");
var btn = form.querySelector("button[type=submit]");
if (!msg || !btn) return;
function say(text, cls) {
msg.textContent = text;
msg.className = "say-msg" + (cls ? " " + cls : "");
}
form.addEventListener("submit", function (e) {
if (!form.checkValidity()) {
e.preventDefault();
var bad = form.querySelector(":invalid");
say(bad && bad.name === "email" && bad.value.trim()
? "That email address will not parse."
: "Both fields are needed.", "bad");
if (bad) bad.focus();
return;
}
e.preventDefault();
btn.disabled = true;
say("sending…");
fetch(form.action, {
method: "POST",
body: new FormData(form),
headers: { Accept: "application/json" }
})
.then(function (res) {
if (res.ok) {
form.reset();
say("Sent. A person reads these; give it a day or two.", "ok");
} else {
say("The endpoint returned " + res.status + ". Nothing was sent — the issues link below still works.", "bad");
}
btn.disabled = false;
})
.catch(function () {
say("That did not reach the endpoint. Nothing was sent — the issues link below still works.", "bad");
btn.disabled = false;
});
});
})();
