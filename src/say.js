/* ==========================================================================
   The correction form's progressive upgrade — SHELL.md r9.

   THE FORM ALREADY WORKS WITHOUT THIS FILE. It is a real <form action method>
   posting to Formspree, so with scripting off the browser submits it and the
   visitor lands on Formspree's own confirmation page. That is the fallback and
   it is a working one, which is the whole reason this is a form and not a
   fetch bolted to a button.

   All this adds is an inline reply, so the page does not hand the reader off
   to somebody else's thank-you screen.

   The one rule that matters: "sent" is printed only after the endpoint
   actually returns 2xx. A form that says thank-you on submit and silently
   drops the message is exactly the defect this portfolio keeps finding — a
   control that looks wired and is not — and it is the default behaviour of
   most hand-rolled AJAX forms.
   ========================================================================== */
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
    /* checkValidity is ours to call because the form carries novalidate: the
       browser's own bubbles are styled by the browser, not by us. */
    if (!form.checkValidity()) {
      e.preventDefault();
      var bad = form.querySelector(":invalid");
      /* An EMPTY required field and a malformed address are different faults
         and the reply says which. Reporting "that will not parse" at an empty
         box is a small instance of the defect this whole page is about: a
         control telling the reader something that is not so. */
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
        /* Re-enabled either way, so a second message is possible without a
           reload. The reset form cannot resend the first one, because empty
           fails validation. */
        btn.disabled = false;
      })
      .catch(function () {
        say("That did not reach the endpoint. Nothing was sent — the issues link below still works.", "bad");
        btn.disabled = false;
      });
  });
})();
