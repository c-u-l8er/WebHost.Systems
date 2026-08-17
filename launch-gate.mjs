/* ==========================================================================
   webhost.systems publication gate. No dependencies.

       node launch-gate.mjs        (run it via: npm run site:launch)

   It reads the ARTIFACT — the generated index.html, boot.js and say.js — and
   refuses when the artifact says something the records do not support. It also
   RE-DERIVES the artifact from source and compares, so it cannot be handed a
   stale file by a build that threw.

   SHELL.md §4. Every check below has a reason and most of them have a scar.
   The three newest are the ones to understand first:

     · r6 hole 1 — the retraction check COUNTS occurrences and bounds them. The
       reference implementation asked "is the string inside the retraction?" and
       permitted it everywhere once the answer was yes, so a page could keep its
       retraction AND put the claim back in the hero and pass.
     · r6 hole 2 — nothing proved the artifact came from its own source. If the
       build threw, the previous index.html stayed on disk and the gate approved
       a stale artifact. Here the gate imports render() and compares.
     · r8 — `<[^>]+>` does not remove an HTML comment that contains a ">", so
       the remainder of the comment was being counted as visible page text. On a
       page whose whole substance is retracted claims quoted in place, that
       makes the retraction counter unreliable in BOTH directions. Comments are
       stripped as their own pass here, before anything else.

   The cascade resolver in §16 is adapted from bendscript.com's, which was
   cross-checked against a browser's own computed styles. SHELL.md r8 says to
   copy that check rather than the `:not(.btn)` patch, because the patch fixes
   today's instance and the check fixes the class.
   ========================================================================== */
import { readFileSync, existsSync } from "fs";
import { createHash } from "crypto";
import { probeAll, checkFrozen, render } from "./build-site.mjs";

const read = (p) => readFileSync(p, "utf8");
const J = (p) => JSON.parse(read(p));
const sha = (s) => createHash("sha256").update(s).digest("hex");

const surface = J("./records/surface.json");
const frozen = J("./records/evidence.json");
const pkg = J("./package.json");
const stamp = existsSync("./records/build-stamp.json") ? J("./records/build-stamp.json") : null;
const ENDPOINT = surface.contact.url;

let pass = 0, fail = 0;
function T(name, ok, detail = "") {
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
    ok ? pass++ : fail++;
}

for (const f of ["./index.html", "./boot.js", "./say.js"]) {
    if (!existsSync(f)) { console.error(`FAIL  missing artifact ${f} — run the build first`); process.exit(1); }
}
const landing = read("./index.html");
const anim = read("./boot.js");
const sayJs = read("./say.js");

/* ==========================================================================
   0. TEXT EXTRACTION — SHELL.md r8. Comments first, as their own pass.

   `<[^>]+>` stops at the first ">". An HTML comment containing one — and the
   source comments on this page contain "-->" and ">" freely — is only
   partially removed, and the tail of the comment is then counted as visible
   text. Every "no constant leaked" and "retracted string absent" result
   reported before r8 was unreliable in both directions because of this.
   ========================================================================== */
const ENT = { "&nbsp;": " ", "&ensp;": " ", "&mdash;": "—", "&ndash;": "–", "&minus;": "−", "&rarr;": "→",
    "&amp;": "&", "&copy;": "©", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&times;": "×", "&apos;": "'",
    "&middot;": "·", "&hellip;": "…", "&ldquo;": "“", "&rdquo;": "”", "&lsquo;": "‘",
    "&rsquo;": "’", "&sect;": "§", "&uarr;": "↑" };
const entities = (s) => s.replace(/&\w+;/g, (e) => (e in ENT ? ENT[e] : e));

const stripComments = (h) => h.replace(/<!--[\s\S]*?-->/g, " ");
const stripCodeBlocks = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
/* VISIBLE is what a reader sees. HIDDEN is everything a reader does not:
   comment bodies, attribute values, script and style bodies. A retracted claim
   living in HIDDEN is still discoverable — by a search engine, by view-source,
   by anyone quoting the file — and is refused outright. */
const VISIBLE_NODES = stripCodeBlocks(stripComments(landing))
    .split(/<[^>]*>/).map((s) => entities(s).replace(/\s+/g, " ").trim()).filter(Boolean);
const VISIBLE = VISIBLE_NODES.join("\n");
const HIDDEN = [
    ...[...landing.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]),
    ...[...landing.matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0]),
].join("\n");

/* The r8 regex is a real defect and not a hypothetical, so prove it on this
   artifact rather than trusting the fix: the naive stripper must leave text
   the correct one does not. If the page ever stops carrying a comment with a
   ">" in it this check goes quiet, which is why it reports what it found. */
{
    const naive = stripCodeBlocks(landing).replace(/<[^>]+>/g, " ");
    const naiveWords = new Set(naive.split(/\s+/).filter((w) => w.length > 3));
    const realWords = new Set(VISIBLE.split(/\s+/).filter((w) => w.length > 3));
    const ghosts = [...naiveWords].filter((w) => !realWords.has(w));
    T("comments are stripped as their own pass, and it changes the answer", ghosts.length > 0,
        ghosts.length ? `the naive stripper would have counted ${ghosts.length} words that never render, e.g. ${ghosts.slice(0, 4).map((g) => JSON.stringify(g)).join(", ")}`
            : "no difference on this artifact — the check cannot confirm the fix matters here");
}

/* ---------- 1. release identity ---------- */
T("release identity: package.json == records/surface.json",
    pkg.version === surface.version, `${pkg.version} / ${surface.version}`);
const STAMP = `WEBHOST.SYSTEMS v${surface.version} · RECORDS ${surface.verified_at} · ${surface.shell_revision}`;
T("/ carries the canonical stamp", landing.includes(STAMP), STAMP);
T("the surface records the shell revision it was built against",
    /^shell-r\d+$/.test(surface.shell_revision || ""), surface.shell_revision);

/* ==========================================================================
   2. THE ARTIFACT IS THIS SOURCE'S — SHELL.md r6, hole 2.

   The staleness hole earned its place the hard way on the sibling surface:
   while proving the gate could refuse, a build was run in an environment where
   an import failed. The build threw, index.html was never rewritten, and the
   gate happily approved the PREVIOUS artifact — so two deliberate breaks
   reported PASS and looked like gate holes.

   bendscript closes it by re-deriving the emitted CSS and JS from source and
   asserting the artifact contains them. This goes further and re-derives the
   WHOLE artifact: render() is pure over records/ and src/, so the emitted file
   must be byte-identical to what this source compiles to right now.
   ========================================================================== */
{
    const probes = probeAll();
    const drift = checkFrozen(probes);
    T("every probe still re-derives off disk to the frozen value", drift.length === 0,
        drift.length ? drift.slice(0, 3).join(" | ") : `${Object.keys(probes).length} probes, 0 drift`);

    const out = render(probes);
    T("/ is byte-identical to what this source compiles to", out.html === landing,
        out.html === landing ? `${Buffer.byteLength(landing).toLocaleString()} bytes` : `render() produced ${Buffer.byteLength(out.html)} bytes, index.html is ${Buffer.byteLength(landing)} — the artifact is STALE`);
    T("/boot.js is what src/boot.js compiles to", out.boot === anim);
    T("/say.js is what src/say.js compiles to", out.say === sayJs);

    T("the build stamp exists and matches the artifact on disk",
        !!stamp && stamp.artifacts["index.html"] === sha(landing) &&
        stamp.artifacts["boot.js"] === sha(anim) && stamp.artifacts["say.js"] === sha(sayJs),
        stamp ? `built ${stamp.built_at} on node ${stamp.node}` : "no records/build-stamp.json");
}
T("/ has no unrendered build token", !/\{\{[\w.]+\}\}/.test(landing));
T("/ declares its canonical URL", landing.includes(`<link rel="canonical" href="${surface.origin}/">`));
T("/ declares the surface's falsifiable question",
    landing.includes(`<meta name="falsifiable-question" content="${surface.question}">`));

/* ==========================================================================
   3. THE PAGE'S CONTENT SHIPS WITHOUT JAVASCRIPT — NARROWED 2026-08-17

   This read "the landing page loads exactly two scripts, and both are this
   surface's own" — in effect, no JavaScript at all beyond those two. That is
   the property this surface dropped <amp-nav> to keep, and it dropped it with
   no ruling behind the decision.

   TRAVIS HAS NOW RULED: the ampersand-nav belongs on every website. The nav is
   a WEB COMPONENT and cannot exist without a script, so a check saying "no JS"
   would have had to be DELETED to obey the ruling. It is narrowed instead, to
   the property that was actually being protected:

       NO JAVASCRIPT THE CONTENT DEPENDS ON.

   The partition is explicit and every member is NAMED, never counted, so a
   third-party tag still cannot slip in on a loosened bound:
     · CHROME  — /amp-nav.js, the shared portfolio nav. §3b proves the page's
                 text is character-identical with it deleted.
     · OWN     — /boot.js, the identifying animation, which §12 proves writes
                 nothing into the document; and /say.js, which §5 proves is an
                 upgrade to a form that already posts on its own.
   ========================================================================== */
const CHROME_SCRIPTS = ["/amp-nav.js"];
const OWN_SCRIPTS = ["/boot.js", "/say.js"];
{
    const tags = [...landing.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    T("the landing page ships no inline JavaScript", tags.every((t) => t[2].trim() === ""));
    const srcs = tags.map((t) => (/\bsrc="([^"]+)"/.exec(t[1]) || [])[1]);
    T("the landing page loads only its own two scripts plus the shared nav chrome",
        srcs.length === CHROME_SCRIPTS.length + OWN_SCRIPTS.length &&
        CHROME_SCRIPTS.every((x) => srcs.includes(x)) && OWN_SCRIPTS.every((x) => srcs.includes(x)),
        srcs.join(", ") || "none");
    /* A type="module" script is deferred BY SPECIFICATION — the attribute has
       no effect on one — so requiring the literal word would refuse the nav
       for a reason that is not true of it. */
    T("every script is deferred", tags.every((t) => /\bdefer\b/.test(t[1]) || /\btype="module"/.test(t[1])),
        tags.map((t) => t[1].trim()).join(" | "));
    T("no third-party script is loaded", !srcs.some((x) => /^https?:/.test(x)),
        "the previous artifact pulled three.js off a CDN");
}

/* ==========================================================================
   3a. THE PORTFOLIO NAV IS ON THE PAGE. Ruled by Travis 2026-08-17:
   "the ampersand-nav needs to be on each website!"

   This surface and four siblings each dropped <amp-nav> independently when
   they adopted the shell, to protect the zero-JavaScript content property, and
   no ruling was ever made either way. It has now been made, and this check
   exists so it cannot vanish silently a second time — vanishing silently is
   exactly how it vanished the first time.

   SCOPED TO THE ELEMENT (r14). A `<script src="/amp-nav.js">` mentions the
   filename and is NOT the custom element: /amp-nav/.test(landing) would be
   satisfied by the script tag alone and would report PASS with the nav
   deleted. So this matches the element's opening tag, with comments stripped
   first, so a commented-out nav cannot satisfy it either.
   ========================================================================== */
const NAV_MARKUP = stripComments(landing);
{
    const els = [...NAV_MARKUP.matchAll(/<amp-nav\b([^>]*)>/gi)];
    T("/ carries the shared portfolio nav ELEMENT, not just its script",
        els.length === 1, `${els.length} <amp-nav> element(s)`);
    T("/ files itself under the nav property this surface is recorded as",
        els.length === 1 && new RegExp(`\\bproperty="${surface.nav_property}"`).test(els[0][1]),
        els.length ? els[0][1].trim() : "no element");
    T("the nav component the page loads is in this tree", existsSync("./amp-nav.js"));
    T("the vendored nav knows this property",
        new RegExp(`^\\s*${surface.nav_property}:\\s*\\{`, "m").test(read("./amp-nav.js")),
        `an unknown key renders an EMPTY bar rather than an error — "${surface.nav_property}"`);
}

/* ---------- 3b. and the nav is CHROME: the content does not depend on it ----
   The constraint the ruling had to survive, made mechanical rather than
   asserted in a comment. Delete the nav element AND its script from the
   artifact, re-extract every text node, and require the result to be
   character-identical. If <amp-nav> ever starts carrying page content — a
   fallback list, a status line, anything a reader would miss — this refuses. */
{
    const nodesOf = (h) => stripCodeBlocks(stripComments(h))
        .split(/<[^>]*>/).map((x) => entities(x).replace(/\s+/g, " ").trim()).filter(Boolean).join("\u0000");
    const withoutNav = NAV_MARKUP
        .replace(/<script\b[^>]*src="\/amp-nav\.js"[^>]*>\s*<\/script>/gi, "")
        .replace(/<amp-nav\b[^>]*>[\s\S]*?<\/amp-nav>/gi, "");
    const before = nodesOf(NAV_MARKUP), after = nodesOf(withoutNav);
    T("the page's content does not depend on the nav", before === after,
        `${before.length} extractable characters with the nav, ${after.length} without it`);
    T("the nav element carries no content of its own",
        /<amp-nav\b[^>]*>\s*<\/amp-nav>/i.test(NAV_MARKUP), "it must be empty in the artifact");
}

/* ==========================================================================
   4. CLAIMS THAT WERE RETRACTED MAY NOT COME BACK — r6 hole 1, tightened by r8

   COUNT, do not detect. The reference implementation asked "is the string
   inside the retraction?" and permitted it everywhere once the answer was yes,
   so a page could keep its retraction AND reinstate the sentence in the hero.
   Confirmed by breaking it on the sibling surface: it said PASS.

   Three bounds here rather than one, because this page is mostly retractions:
     · a retracted sentence may appear ONLY inside the retraction block,
     · it may not appear HIDDEN anywhere — a comment or an attribute is still
       published, it is just not published to the reader,
     · and a word that cannot be forbidden outright because it names something
       real gets an explicit min/max instead, so it cannot drift back into a
       feature list one sentence at a time.
   ========================================================================== */
const retractBlock = (() => {
    const i = landing.indexOf('<div class="retract">');
    if (i < 0) return "";
    const j = landing.indexOf("</div>", i);
    return j < 0 ? landing.slice(i) : landing.slice(i, j + 6);
})();
const retractVisible = stripCodeBlocks(stripComments(retractBlock))
    .split(/<[^>]*>/).map((s) => entities(s).replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
const tally = (hay, needle) => hay.split(needle).length - 1;

T("the retraction block is present and findable", retractBlock.length > 0, `${Buffer.byteLength(retractBlock)} bytes`);
T("the retraction block is a leaf — the '</div>' that ends it really ends it",
    retractBlock.length > 0 && !/<div\b/.test(retractBlock.slice(21)),
    "a nested div would truncate the block and silently shrink the allowed region");

for (const s of surface.retracted.sentences) {
    const onPage = tally(VISIBLE, s.text);
    const inBlock = tally(retractVisible, s.text);
    const hidden = tally(HIDDEN, s.text);
    T(`retracted, and quoted only in the retraction: "${s.text}"`,
        onPage === inBlock && onPage >= 1 && hidden === 0,
        `${onPage} visible on the page, ${inBlock} of them inside the retraction, ${hidden} hidden in a comment or attribute`);
}
for (const b of surface.retracted.bounded) {
    const n = tally(VISIBLE, b.text);
    const hidden = tally(HIDDEN, b.text);
    T(`bounded token "${b.text}" stays within ${b.min}–${b.max}`, n >= b.min && n <= b.max && hidden === 0,
        `${n} visible, ${hidden} hidden — ${b.note}`);
}
for (const f of surface.retracted.forbidden) {
    const n = tally(VISIBLE, f) + tally(HIDDEN, f);
    T(`forbidden anywhere: "${f}"`, n === 0, n ? `${n} occurrence(s)` : "absent");
}

/* ==========================================================================
   4b. r15 — THE BUILD PUBLISHES FILES THESE RULES NEVER READ

   r14 was "the gate reads one file; the HOST serves a directory." This is the
   same defect one layer inward: the BUILD writes more than one file, and every
   rule above reads VISIBLE and HIDDEN, both derived from index.html alone. It
   was demonstrated on opensentience.org, where a retracted count was planted
   in a comment inside a published script and the gate reported green — three
   of that build's four emitted files were exempt from every text rule it had.

   This build writes three. The two that are not the page get a HARD ZERO on
   every retracted sentence, every bounded token and every forbidden string: a
   script has no retraction block to hold a quotation, so an occurrence in one
   is a reinstatement with nowhere to hide.

   The vendored ./amp-nav.js is deliberately NOT in this set — it is written by
   ampersand-nav/sync-nav.sh and only lane N may change it. It is covered
   separately, and honestly, in §5.
   ========================================================================== */
const PUBLISHED = ["boot.js", "say.js"];
{
    const ALL_STRINGS = [
        ...surface.retracted.sentences.map((x) => x.text),
        ...surface.retracted.bounded.map((x) => x.text),
        ...surface.retracted.forbidden,
    ];
    T("every file this build writes is accounted for by these checks",
        PUBLISHED.every((f) => existsSync("./" + f)), `index.html + ${PUBLISHED.join(", ")}`);
    for (const f of PUBLISHED) {
        const body = read("./" + f);
        const hits = ALL_STRINGS.filter((x) => body.includes(x));
        T(`/${f} reinstates no retracted, bounded or forbidden string`, hits.length === 0,
            hits.length ? `REINSTATED: ${hits.join(" | ")}` : `${ALL_STRINGS.length} strings checked against ${Buffer.byteLength(body)} bytes`);
        T(`/${f} carries no email address`, !/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(body));
        T(`/${f} carries no unrendered build token`, !/\{\{[\w.]+\}\}/.test(body));
    }
}

/* THE ONE MAILTO THIS SURFACE PUBLISHES AND CANNOT REMOVE — declared, bounded
   and dated rather than silently exempted. "mailto:" is on the forbidden list
   above, which reads index.html. Found 2026-08-17 while restoring the nav: the
   vendored amp-nav.js carries a `contact` entry — "Talk to us",
   hello@ampersandboxdesign.com, href mailto: — which is an ITEM IN A RENDERED
   SECTION, so every surface shipping this nav publishes an email address and a
   mailto: link. Against the standing rule (SITES.md §0.5, Travis 2026-08-11:
   no mailto:, not even as a fallback), and true on the surfaces that kept the
   nav all along — the rule read index.html and the mailto was in a script,
   which is r15 exactly.

   ampersand-nav/ is lane N's and a vendored copy must not be hand-edited, so
   this gate does the only honest thing available to it: BOUND the exception at
   the one occurrence measured and refuse if it grows. Flagged [TRAVIS] in the
   lane report. If lane N removes it, this still passes at 0. */
{
    const navSrc = read("./amp-nav.js");
    const mailtos = navSrc.split("mailto:").length - 1;
    T("the vendored nav's mailto: exception has not grown past the one declared",
        mailtos <= 1,
        `${mailtos} mailto: in amp-nav.js — a KNOWN portfolio-wide defect owned by lane N, not by this repo`);
}
/* The blocklist stops exact strings. It cannot stop a paraphrase, and a fuzzy
   "does this sound like a claim" regex was tried on the sibling surface and
   refused three sentences that were telling the truth. So this is the
   AFFIRMATIVE half: the page must carry the retraction, and must publish the
   open gates as open. Neither can pass while the page quietly re-asserts. */
T("/ carries the retraction rather than a silent edit",
    landing.includes("Retracted, in place") && /rather than quietly refreshed/.test(landing));
T("/ publishes the unbuilt runtime as unbuilt",
    surface.unmeasured.some((u) => u.id === "runtime_execution") &&
    landing.includes(surface.unmeasured.find((u) => u.id === "runtime_execution").name));
T("the runtime gate is pending, not approved",
    surface.gates.runtime_execution.status === "pending" && surface.gates.runtime_execution.evidence === null);

/* ---------- 5. no dead mailbox anywhere ---------- */
T("/ advertises no mailto:", !landing.includes("mailto:"));
T("the correction channel is a live URL, not a mailbox",
    /^https:\/\//.test(surface.contact.url) && surface.contact.kind !== "mailto");
/* app.webhost.systems returned NXDOMAIN when this was written — the dashboard's
   hostname is gone, not merely backendless, and three CTAs used to point at it.
   The page may NAME it, because the withdrawal is part of what it reports; it
   may not LINK it. "A link that returns 200 can still be dead" (SITES.md §0.5),
   and this one does not even reach a 200. */
{
    const linked = [...landing.matchAll(/(?:href|src|action)="([^"]*)"/g)].map((m) => m[1])
        .filter((u) => /app\.webhost\.systems/.test(u));
    T("/ links nothing at the withdrawn dashboard host", linked.length === 0,
        linked.length ? linked.join(", ") : `named in prose ${landing.split("app.webhost.systems").length - 1}×, linked 0×`);
}

/* ---------- 6. every rung on the artifact is a real rung ---------- */
const RUNGS = ["spec", "in_tree", "live_local", "live_deployed", "external", "?"];
{
    const chips = [...landing.matchAll(/<span class="rung" data-rung="([^"]*)"[^>]*>([^<]*)<\/span>/g)];
    T("/ renders at least one rung chip", chips.length > 0, `${chips.length} chips`);
    T("/ renders only real rungs", chips.every((c) => RUNGS.includes(c[1])),
        chips.map((c) => c[1]).filter((r) => !RUNGS.includes(r)).join(", ") || "all valid");
    T("/ chip text always equals its stored rung", chips.every((c) => c[1] === c[2]));
    T("/ never defaults an unknown rung",
        !/data-rung=""/.test(landing) && !/data-rung="undefined"/.test(landing) && !/data-rung="null"/.test(landing));
    T("the surface rung is a rung or an honest '?'", RUNGS.includes(surface.surface_rung), surface.surface_rung);

    /* "?" is a first-class state, not a default (SHELL.md §1 rule 2), and it
       has to be earned as much as a rung does: the record must say WHY, and no
       artifact may be sitting there at a rung the surface is declining to
       claim upward. Both directions, or "?" becomes a way to avoid the check. */
    if (surface.surface_rung === "?") {
        T("a '?' rung says why it is unsettled", !!surface.rung_unsettled_because,
            (surface.rung_unsettled_because || "").slice(0, 80) + "…");
        T("a '?' rung's named witness is PENDING, which is what makes it '?'",
            surface.gates[surface.rung_witness] && surface.gates[surface.rung_witness].status === "pending",
            surface.rung_witness);
        T("no artifact on a '?' surface claims live_deployed or external",
            !surface.artifacts.some((a) => ["live_deployed", "external"].includes(a.rung)),
            "an unsettled surface rung cannot be hiding a deployed artifact");
    } else {
        T("the surface rung is the rung of its best-evidenced artifact",
            surface.artifacts.some((a) => a.rung === surface.surface_rung));
        T("the witnessing gate is approved, with its evidence",
            surface.gates[surface.rung_witness] && surface.gates[surface.rung_witness].status === "approved" &&
            ["evidence", "reviewer", "date"].every((f) => surface.gates[surface.rung_witness][f]));
    }
    T("the surface names the gate that witnesses its rung",
        !!surface.rung_witness && !!surface.gates[surface.rung_witness], surface.rung_witness);
}

/* ---------- 6b. the band may only claim what the PLACE permits ----------
   The place is a record in ampersand-nav, not a choice made here. amp-nav
   files webhost as place:2 with layer "runtime", and its renderPlacement()
   emits the layer sentence for place 2. A band that said anything else would
   contradict the nav rendered directly beneath it — the gpscoord tier-4
   defect. And the check refuses in BOTH directions (r5): a place-2 band that
   quietly DROPS its layer word is the same defect inverted, and it passed
   until someone tried it. */
T("the surface declares its place", [1, 2, 3, 4].includes(surface.tier), `place ${surface.tier}`);
T("/ band carries the declared place", landing.includes(`<div class="band" data-tier="${surface.tier}">`));
{
    const SENTENCES = {
        2: `is the <b>${surface.layer}</b> layer of ${surface.parent}`,
        3: `a <b>specification</b> in the ${surface.parent} world`,
        4: `A <b>${surface.parent}</b> project`,
    };
    const mine = SENTENCES[surface.tier];
    T(`/ band carries the sentence place ${surface.tier} requires`, !!mine && landing.includes(mine), mine);
    const wrong = Object.entries(SENTENCES)
        .filter(([p]) => Number(p) !== surface.tier && landing.includes(SENTENCES[p])).map(([p]) => `place ${p}`);
    T("/ band carries no OTHER place's sentence", wrong.length === 0, wrong.join(", ") || "only its own");
}
T("the placement band bounds what its rung covers", landing.includes(surface.surface_rung_covers));

/* r6: the nav stacking breakpoint is the SURFACE's, measured, and recorded —
   not the shell's 430px, which was measured on a four-item nav. 800px was in
   the stylesheet and in no record, so nothing compared the two. */
T("the nav stacking breakpoint is the one this surface measured",
    new RegExp(`@media\\(max-width:${surface.nav_stack_px}px\\)\\{\\.top\\{flex-direction:column`)
        .test(read("./src/shell.css").replace(/\s*\n\s*/g, "")),
    `${surface.nav_stack_px}px`);

/* r11 — AND THE MEASUREMENT IS BOUND TO THE LABELS IT WAS TAKEN WITH.
   A breakpoint measured against a nav whose items can be renamed without
   notice is a stale number waiting to happen: on another surface, renaming one
   item to "Correct us" — five characters — moved the wrap point 538 → 576,
   past a 560 breakpoint, marooning the logo in a broken two-row state between
   561 and 575, and nothing was checking. */
{
    const navBlock = /<div class="top">[\s\S]*?<\/nav>/.exec(NAV_MARKUP);
    const labels = navBlock
        ? [...navBlock[0].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)]
            .map((m) => entities(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
            .slice(1)                                     /* [0] is the logo */
        : [];
    const want = surface.nav_labels_at_measure || [];
    T("the nav still carries the labels the breakpoint was measured with (r11)",
        labels.length === want.length && labels.every((l, i) => l === want[i]),
        labels.join(" · ") || "no nav found");
}
/* The chip in the band prints the NAV's word, not this lane's opinion. amp-nav
   stores rung:null for webhost and its own RUNG_LABEL renders null as "?". */
T("the band's chip is the word amp-nav renders for this surface",
    surface.nav_rung === null && surface.surface_rung === "?",
    `amp-nav stores ${JSON.stringify(surface.nav_rung)}, RUNG_LABEL renders that as "?", the band prints "${surface.surface_rung}"`);

/* ---------- 6c. every §N on the page resolves in the spec it cites ----------
   Cheap, and it catches a citation that drifted when a spec was rewritten.
   FENCES ARE STRIPPED FIRST: a markdown heading inside a fenced code block is
   not a heading. This spec set numbers its sections "## 1) Scope" rather than
   "## 1. Scope", so both forms are read. */
{
    const specPath = "./" + surface.spec_file;
    T("the spec file this surface cites exists", existsSync(specPath), surface.spec_file);
    if (existsSync(specPath)) {
        const md = read(specPath).replace(/^```[\s\S]*?^```/gm, "");
        const heads = new Set([...md.matchAll(/^#{1,6}\s+(\d+(?:\.\d+)*)[.)]?\s/gm)].map((m) => m[1]));
        const used = new Set([...md.matchAll(/§\s?(\d+(?:\.\d+)*)/g)].map((m) => m[1]));
        const cited = [...new Set([...VISIBLE.matchAll(/§\s?(\d+(?:\.\d+)*)/g)].map((m) => m[1]))];
        const dangling = cited.filter((c) => !heads.has(c) && !used.has(c));
        T("every § citation on the page resolves in the spec it cites", dangling.length === 0,
            dangling.length ? `DANGLING: ${dangling.map((d) => "§" + d).join(", ")}`
                : `${cited.length} citations on the page, ${heads.size} numbered headings in ${surface.spec_file}`);
    }
}
/* This surface cites FILES rather than sections, so the load-bearing version
   of that check is: every repository path printed on the page must exist. */
{
    const paths = [...new Set([...VISIBLE.matchAll(/\b((?:apps|docs|records|src|packages)\/[\w./-]*[\w/])/g)].map((m) => m[1]))];
    const supa = [...new Set([...VISIBLE.matchAll(/\bampersand-supabase\/([\w./-]*[\w/])/g)].map((m) => m[1]))];
    const dead = [
        ...paths.filter((p) => !existsSync("./" + p) && !/^packages\//.test(p)),
        ...supa.filter((p) => !existsSync("../ampersand-supabase/" + p)),
    ];
    T("every repository path printed on the page exists", dead.length === 0,
        dead.length ? `DEAD: ${dead.join(", ")}` : `${paths.length + supa.length} paths, all resolve (packages/ excepted — its absence is the claim)`);
    T("packages/ is still absent, which is what the page says", !existsSync("./packages"));
}

/* ==========================================================================
   6d. THE AGENT-FACING DOCS ARE PART OF THE ARTIFACT

   AGENTS.md described a serverless backend and an auth provider this
   repository has never depended on, and routed readers to apps/control-plane/
   and packages/, neither of which exists. It said so for as long as the
   marketing page did, and the 2026-08-16 takedown did not reach it — so the
   claims were retracted on the page a visitor reads and left standing in the
   file every agent reads first. That is worse, not better.

   Two exact checks, no fuzz. AGENTS.md is a short instruction file with no
   narrative role, so it may not name these at all; README.md is where the
   history is told and is deliberately not subject to this. And every path it
   names must exist, which is the same defect class as a quick-start command
   that does not run.
   ========================================================================== */
{
    const agents = read("./AGENTS.md");
    const GONE = ["Convex", "convex", "Clerk", "apps/control-plane"];
    const named = GONE.filter((g) => agents.includes(g));
    T("AGENTS.md names no dependency this repository does not have", named.length === 0,
        named.length ? `still names: ${named.join(", ")}` : "none of the retracted stack survives in it");
    const paths = [...new Set([...agents.matchAll(/(?:^|[\s`(])((?:src|records|docs|apps|packages|old_scrap)\/[\w./*-]*[\w/])/gm)].map((m) => m[1]))];
    const dead = paths.filter((p) => !p.includes("*") && !existsSync("./" + p));
    T("every path AGENTS.md names exists on disk", dead.length === 0,
        dead.length ? `DEAD: ${dead.join(", ")}` : `${paths.length} paths, all resolve`);
    T("AGENTS.md says the marketing page is generated", /GENERATED\. Do not hand-edit/.test(agents),
        "an agent that hand-edits index.html loses the edit on the next build");
}

/* ---------- 7. §0.7 — the rung gates the call to action ---------- */
const VERBS = {
    spec: ["Read", "Challenge", "Implement"],
    in_tree: ["Inspect the source", "Run the tests"],
    live_local: ["Use it", "Reproduce it locally"],
    live_deployed: ["Use the deployed artifact"],
    external: ["See independent evidence", "Contribute another result"],
};
{
    const groups = [...landing.matchAll(/<div class="ctagroup"><div class="tag[^"]*">(\w+) &mdash;[\s\S]*?<\/div><\/div>/g)];
    T("/ has at least one call to action", groups.length > 0, `${groups.length} groups`);
    const bad = [];
    for (const g of groups) {
        const allowed = VERBS[g[1]] || [];
        for (const v of [...g[0].matchAll(/<span class="verb">([^<]*)<\/span>/g)]) {
            const verb = entities(v[1]);
            if (!allowed.includes(verb)) bad.push(`${verb} @ ${g[1]}`);
        }
    }
    T("/ asks only what its rung has earned", bad.length === 0, bad.join("; ") || "ok");
    T("every artifact rung on this surface has its own CTA group",
        [...new Set(surface.artifacts.map((a) => a.rung))].every((r) => groups.some((g) => g[1] === r)),
        [...new Set(surface.artifacts.map((a) => a.rung))].join(", "));

    /* The verb table governs CTA cards. Buttons are an ask too, and the ones on
       this page's history — "Launch Dashboard", "Open Dashboard", "Launch App"
       — were exactly the asks a rung had not earned. So every button label must
       begin with a verb some rung on this page has earned, or be the form's
       submit. */
    const OK_BTN = [...new Set(Object.entries(VERBS).filter(([r]) => ["spec", "in_tree"].includes(r)).flatMap(([, v]) => v)), "Read", "Send"];
    const labels = [...landing.matchAll(/<(?:a|button)\b[^>]*class="btn[^"]*"[^>]*>([\s\S]*?)<\/(?:a|button)>/g)]
        .map((m) => entities(m[1].replace(/<[^>]*>/g, "")).trim());
    const badBtn = labels.filter((l) => !OK_BTN.some((v) => l.startsWith(v)));
    T("/ every button asks for something this page's rungs have earned", badBtn.length === 0 && labels.length > 0,
        badBtn.length ? `NOT EARNED: ${badBtn.join(", ")}` : `${labels.length} buttons: ${labels.join(" · ")}`);
}

/* ---------- 8. the status block, and the review ledger ---------- */
for (const label of ["Status", "Last verified", "Source", "Limit", "Next rung"]) {
    T(`the status block states ${label}`, landing.includes(`<dt>${label}</dt>`));
}
T("the LIMIT names something the evidence does NOT establish",
    /does not establish|does not claim|has not/i.test(surface.status.limit));
const NEED = ["evidence", "reviewer", "date"];
const gates = Object.entries(surface.gates).filter(([k]) => k !== "_comment");
T("review ledger: every gate has a valid status", gates.every(([, g]) => ["pending", "approved"].includes(g.status)));
T("review ledger: no approval without its evidence",
    gates.every(([, g]) => g.status !== "approved" || NEED.every((f) => g[f])));
T("review ledger: no pending gate is carrying evidence it has not been given",
    gates.every(([, g]) => g.status !== "pending" || NEED.every((f) => g[f] === null)));
T("review ledger: the deployed-page gate is honest about what the domain serves",
    surface.gates.deployed_page_check.status === "pending",
    "the domain served the pre-takedown page when this was written; that is a ledger row, not a page claim");

/* ==========================================================================
   9. NO NUMBER ON THIS PAGE WAS TYPED BY HAND

   SHELL.md §4.1. The first draft of records/surface.json said "eleven
   specification documents" and the probe counted ten. Two checks close that:
   every bare integer rendered on the page must be a value some probe derived
   or a declared zero count; and the RENDERED fields of the record may not
   contain a multi-digit run at all outside an ISO date, nor a count spelled as
   a word, because both are how a typed number gets back in.
   ========================================================================== */
{
    const derived = new Set([
        ...Object.values(frozen.probes).map((p) => String(p.value)).filter((v) => v !== "undefined"),
        ...Object.values(frozen.probes).map((p) => String(p.line)).filter((v) => v !== "null"),
        ...surface.zero_counts.map((z) => z.value),
    ]);
    const bare = VISIBLE_NODES.filter((t) => /^\d+$/.test(t));
    const undeclared = [...new Set(bare)].filter((n) => !derived.has(n));
    T("every bare number on the page is one a probe derived", undeclared.length === 0,
        undeclared.length ? `UNDECLARED: ${undeclared.join(", ")}` : `${bare.length} bare numbers, all from ${derived.size} derived values`);
}
{
    const rendered = [
        surface.surface_rung_covers, surface.status.statement, surface.status.source, surface.status.limit,
        surface.advance.requires, surface.question,
        ...surface.artifacts.flatMap((a) => [a.name, a.detail, a.witness, a.where]),
        ...surface.unmeasured.flatMap((u) => [u.name, u.detail, u.needs, u.built]),
        ...surface.zero_counts.flatMap((z) => [z.label, z.witness]),
        ...surface.retracted.sentences.map((s) => s.note),
    ];
    /* The TEMPLATE is checked with the same rule and for the same reason: its
       first draft said "six edge functions" in the hero lede, and a count typed
       into a template is more fragile than one typed into a record, because
       nothing else in a template looks like data. */
    const tplText = read("./src/landing.html")
        .replace(/<!--[\s\S]*?-->/g, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]*>/g, " ");
    const WORDS = /\b(three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|twenty|thirty|forty)\b/i;
    const offenders = [];
    for (const s of [...rendered, tplText]) {
        const stripped = String(s).replace(/\{\{probe\.\w+\}\}/g, "#").replace(/\d{4}-\d{2}-\d{2}/g, "#");
        if (/\d{2,}/.test(stripped)) offenders.push(`digits: ${/.{0,30}\d{2,}.{0,30}/.exec(stripped)[0]}`);
        const w = WORDS.exec(stripped);
        if (w) offenders.push(`the word "${w[1]}": ${String(s).slice(Math.max(0, w.index - 30), w.index + 40)}…`);
    }
    T("no rendered record field or template line carries a hand-typed count", offenders.length === 0,
        offenders.length ? offenders.slice(0, 3).join(" | ") : `${rendered.length} rendered fields + the template, every count a {{probe}} reference`);
}

/* ---------- 10. every path this page tells a reader to load resolves ---------- */
{
    const hrefs = [...new Set([...landing.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)].map((m) => m[1]))];
    const dead = hrefs.filter((h) => !existsSync("." + (h.endsWith("/") ? h + "index.html" : h)));
    T("every same-origin path the page links resolves in the tree", dead.length === 0,
        dead.length ? `DEAD: ${dead.join(", ")}` : `${hrefs.length} paths`);
    const anchors = [...new Set([...landing.matchAll(/href="#([\w-]+)"/g)].map((m) => m[1]))];
    const deadAnchor = anchors.filter((a) => !new RegExp(`id="${a}"`).test(landing));
    T("every in-page anchor has a target", deadAnchor.length === 0, deadAnchor.join(", ") || `${anchors.length} anchors`);
}

/* ---------- 11. density ---------- */
/* r15: String.length counts UTF-16 CODE UNITS, not bytes. This page carries
   —, §, ↑ and · by the dozen, so the two differ — and SITES.md §0.1 makes a
   local-vs-served BYTE comparison the deploy check, which a character count
   would report as a failed deploy on any page containing one of them. */
T("the landing page stays small", Buffer.byteLength(landing) < 46000, `${Buffer.byteLength(landing).toLocaleString()} bytes`);

/* ==========================================================================
   12. SHELL.md §8.5 — THE IDENTIFYING ANIMATION ASSERTS NOTHING

   gpscoord.com shipped a canvas globe whose vehicles were created by
   `for (let i = 0; i < 12; i++)`, and printed beside it, for months:

       12   Active Pathfinders

   A decoration's internal constant was published as a live user metric. The
   checks below are that defect mechanised. WHEN ONE FIRES, THE ANIMATION
   CHANGES — never the page. The page's figures are re-derived off disk and
   have witnesses; the animation is decoration and can pick any number it
   likes. Decoration yields.
   ========================================================================== */
{
    const marked = [...landing.matchAll(/<[a-z]+\b[^>]*\bdata-identity-animation\b[^>]*>/gi)];
    T("the landing page marks an element data-identity-animation", marked.length >= 1, `${marked.length} marked`);
    const firstSection = (landing.split("<section")[1] || "").split("</section>")[0];
    T("the identity animation is above the fold — inside the first section",
        firstSection.includes("data-identity-animation"));
    T("the h1 comes before the identity animation — the question comes first",
        landing.indexOf("<h1") > -1 && landing.indexOf("<h1") < landing.indexOf("data-identity-animation"));
    /* r9: above the fold is about PLACEMENT, not presence. In flow in the hero
       grid at every width, never absolutely positioned off the side and never
       hidden at a breakpoint — the two ways an animation ends up "on the page"
       and out of frame. */
    T("the animation is in flow, not parked off the edge of the hero",
        !/\.idanim\{[^}]*position:absolute/.test(landing) && /\.idanim\{[^}]*height:/.test(landing));
    T("the animation is not hidden at any breakpoint",
        !/\.idanim[^{]*\{[^}]*display:none/.test(landing) && !/\.idanim[^{]*\{[^}]*opacity:0/.test(landing));
}

const ANIM_NUMS = new Set();
const ANIM_STRS = new Set();
for (const m of anim.matchAll(/(?<![\w.$])\d+(?:\.\d+)?/g)) {
    const v = Number(m[0]);
    if (Math.abs(v) >= 2) ANIM_NUMS.add(String(v));
}
for (const m of anim.matchAll(/"([^"\\\n]{3,})"|'([^'\\\n]{3,})'/g)) ANIM_STRS.add(m[1] ?? m[2]);

{
    const shown = new Set();
    for (const t of VISIBLE_NODES) {
        shown.add(t);
        if (/^-?[\d,]*\d(?:\.\d+)?$/.test(t) && t.includes(",")) shown.add(t.replace(/,/g, ""));
    }
    const leaked = [...shown].filter((t) => ANIM_NUMS.has(t) || ANIM_STRS.has(t));
    T("no text on the landing page is a constant read from the animation", leaked.length === 0,
        leaked.length ? `LEAKED: ${leaked.map((l) => JSON.stringify(l)).join(", ")} — change src/boot.js, not the page`
            : `${ANIM_NUMS.size + ANIM_STRS.size} constants vs ${VISIBLE_NODES.length} text nodes, disjoint`);
}
{
    const recordText = ["surface", "evidence"].map((f) => read(`./records/${f}.json`)).join("\n");
    const shared = [...ANIM_STRS].filter((s) => recordText.includes(s));
    T("the animation shares no string with a frozen record", shared.length === 0,
        shared.length ? `SHARED: ${shared.map((s) => JSON.stringify(s)).join(", ")}` : `${ANIM_STRS.size} strings, none in records`);
}
{
    const FORBIDDEN = ["innerHTML", "outerHTML", "textContent", "innerText", "insertAdjacentHTML",
        "document.write", "createElement", "createTextNode", "appendChild", "setAttribute",
        "getElementById", "getElementsBy", "localStorage", "sessionStorage", "XMLHttpRequest", "fetch("];
    const found = FORBIDDEN.filter((k) => anim.includes(k));
    T("the animation neither reads nor writes page content", found.length === 0, found.join(", ") || "no DOM content API used");
    const queries = [...anim.matchAll(/querySelector(?:All)?\(\s*([^)]*)\)/g)].map((m) => m[1]);
    T("the animation queries nothing but its own canvas",
        queries.length === 1 && queries[0].includes("data-identity-animation"), queries.join(" | ") || "none");
}
T("the animation honours prefers-reduced-motion", anim.includes("prefers-reduced-motion"));
T("the animation renders one frame and stops under reduced motion",
    /if\s*\(reduce\s*&&\s*reduce\.matches\)\s*\{\s*still\(\);\s*return;/.test(anim));
T("the animation never uses IntersectionObserver", !anim.includes("IntersectionObserver"));
T("the animation stops when the tab is hidden", anim.includes("document.hidden"));
T("the animation caps its frame rate", /1000\s*\/\s*FPS/.test(anim));
T("the animation stays cheap enough for a phone", Buffer.byteLength(anim) < 9000, `${Buffer.byteLength(anim).toLocaleString()} bytes`);

/* ==========================================================================
   13. CONTRAST — every declared text token, on the surface it sits on

   --fg3 shipped at .34 across this shell, which is 2.78:1 against the band. It
   colours the .covers span and every .status dt — the two elements whose whole
   job is keeping the page honest. WCAG 2.1 SC 1.4.3, computed rather than
   eyeballed. §16 then does the half this cannot do: a DECLARED token is not a
   PAINTED colour.
   ========================================================================== */
const sheet = read("./src/shell.css");
const TOKENS = {};
for (const m of sheet.slice(sheet.indexOf("/* TOKENS-START"), sheet.indexOf("/* TOKENS-END"))
    .matchAll(/--([\w-]+)\s*:\s*([^;\n}]+)/g)) TOKENS[m[1]] = m[2].trim();
if (!TOKENS.ink) throw new Error("launch-gate found no token block in src/shell.css");

function colour(v) {
    const raw = (TOKENS[String(v).replace(/^--/, "")] || String(v)).trim();
    let m = /^#([0-9a-f]{6})$/i.exec(raw);
    if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16), 1];
    m = /^rgba?\(([^)]+)\)$/i.exec(raw);
    if (m) { const p = m[1].split(",").map((x) => Number(x.trim())); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    throw new Error(`launch-gate cannot read the colour ${JSON.stringify(v)} -> ${raw}`);
}
const composite = (f, b) => [f[3] * f[0] + (1 - f[3]) * b[0], f[3] * f[1] + (1 - f[3]) * b[1], f[3] * f[2] + (1 - f[3]) * b[2], 1];
function solid(spec) {
    const layers = Array.isArray(spec) ? spec : [spec];
    let base = colour(layers[0]); base = [base[0], base[1], base[2], 1];
    for (let i = 1; i < layers.length; i++) base = composite(colour(layers[i]), base);
    return base;
}
const chan = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (c) => 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
function contrast(fgSpec, bgSpec) {
    const bg = solid(bgSpec);
    const fg = composite(colour(fgSpec), bg);
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const CONTRAST_PAIRS = [
    ["--fg", "--ink", "body copy"],
    ["--fg", "--ink2", "card headings, the band's bold word, the plane titles"],
    ["--fg", "--ink3", "the table's raised header row"],
    ["--fg2", "--ink", "lede and prose"],
    ["--fg2", "--ink2", "status values, the band's .covers span, rung chip text, form input text"],
    ["--fg2", "--ink3", "raised-surface secondary text"],
    ["--fg3", "--ink", "section labels on the page"],
    ["--fg3", "--ink2", "every .status dt, .needs, the form labels, the footer"],
    ["--fg3", "--ink3", "table column headers"],
    ["--acc", "--ink", "links in prose"],
    ["--acc", "--ink2", "CTA verbs, eyebrows, the logo on hover, the ghost button on hover"],
    ["--acc", ["--ink2", "--acc-soft"], "a CTA card while hovered"],
    ["--data", "--ink2", "the where-tag, the built chips, a sent reply"],
    ["--data", ["--ink2", "--data-soft"], "a built chip on its own tint"],
    ["--warn", "--ink2", "the LIMIT row, the claim tag, the ? rung, the empty plane"],
    ["--warn", ["--ink2", "rgba(245,196,81,.06)"], "the claim tag on its own tint"],
    ["--acc-ink", "--acc", "the label inside a primary button"],
    ["#9aa4b2", "--ink2", "the spec rung chip"],
    ["#7aa2f7", "--ink2", "the in_tree rung chip"],
    ["#4ade80", "--ink2", "the live_deployed rung chip"],
    ["#c4a1ff", "--ink2", "the external rung chip"],
];
const MIN_RATIO = 4.5;
let worst = Infinity, worstName = "";
for (const [fg, bg, where] of CONTRAST_PAIRS) {
    const r = contrast(fg, bg);
    const name = `${fg} on ${Array.isArray(bg) ? bg.join(" + ") : bg}`;
    if (r < worst) { worst = r; worstName = name; }
    T(`contrast ${name} — ${where}`, r >= MIN_RATIO, `${r.toFixed(2)}:1`);
}
T("the least legible declared pair clears the 4.5:1 floor", worst >= MIN_RATIO,
    `${worstName} at ${worst.toFixed(2)}:1`);

/* ==========================================================================
   14. EVERY INTERACTIVE ELEMENT CAN BE SEEN TO BE INTERACTIVE
   .logo had no :hover rule at all on the reference surface, so hovering the
   top-left changed nothing and there was no way to tell it was a link.
   ========================================================================== */
{
    const styles = [...landing.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
    const hoverSel = [...styles.matchAll(/([^{}]*?):hover/g)].map((m) => m[1]).join(" , ");
    const handles = new Set();
    for (const el of landing.matchAll(/<(a|button)\b([^>]*)>/gi)) {
        const cls = /class="([^"]*)"/.exec(el[2]);
        handles.add(cls ? "." + cls[1].trim().split(/\s+/)[0] : el[1].toLowerCase());
    }
    const naked = [...handles].filter((h) =>
        h.startsWith(".") ? !new RegExp(`\\${h}(?![\\w-])`).test(hoverSel)
            : !new RegExp(`(^|[\\s>+~,(])${h}(?=[\\s.:>+~,)]|$)`, "m").test(hoverSel));
    T("/ every interactive element has a visible :hover", naked.length === 0,
        naked.length ? `no hover for: ${naked.join(", ")}` : `${handles.size} kinds, all covered`);
    T("/ declares a focus-visible ring", /:focus-visible\s*\{/.test(styles));
    T("/ the form's own controls show focus", /\.say input\[type=email\]:focus/.test(styles));
}

/* ==========================================================================
   15. h1 LINE-HEIGHT CLEARS THE FONT'S INK BOX — SHELL.md r7

   agentromatic's h1 was Syne at 65.6px with line-height 1.02: a 66.9px line
   box around 78.7px of ink, so consecutive lines overlapped by 11.8px and the
   descenders read as clipped. Display faces vary enormously; 1.02 is safe in
   one and broken in another.

   The measurement itself needs a browser and was done in one, with the webfont
   confirmed loaded — an unloaded face silently measures the fallback and the
   whole exercise is void. Space Grotesk 600 at 56px: 42px of ink for this h1's
   own string, 51px for a descender probe, so the floor for this face is
   51/56 = 0.911. What is mechanised here is that floor, so nobody lowers the
   value back past it without going and re-measuring.
   ========================================================================== */
{
    const INK_FLOOR = 0.92;   /* measured: 51px of ink at 56px in Space Grotesk 600 */
    const m = /h1\{[^}]*line-height:([\d.]+)/.exec(landing);
    T("the h1 declares a line-height", !!m, m ? m[1] : "none found");
    T("the h1's line box clears its measured ink box", m && Number(m[1]) >= INK_FLOOR,
        m ? `line-height ${m[1]} against a measured ink floor of ${INK_FLOOR} for this face` : "");
}

/* ==========================================================================
   16. THE COMPUTED COLOUR ON A REAL .btn — NOT THE ONE THE TOKEN DECLARES

   SHELL.md r7 and r8. `.top nav a` is specificity 0,2,1 and `.btn` is 0,1,0,
   so on all nine surfaces built before this one the nav rule won and the
   header button painted --fg2 on the accent, while the identical button in the
   hero painted its declared dark ink.

   EVERY CONTRAST CHECK IN §13 PASSED THE WHOLE TIME. They read the DECLARED
   token pair and never the colour the cascade actually gives a real element in
   its real ancestor context. That is the entire hole.

   So: resolve the cascade over the ARTIFACT — every rule that sets `color` or
   a custom property, matched against each .btn's real ancestor chain, with
   specificity, source order, !important, @media at a given width, var() and
   inherit — and refuse when a button's computed colour is not the one a .btn
   rule declares. Adapted from bendscript.com's resolver, whose verdicts were
   cross-checked against a browser's own getComputedStyle.

   Two properties keep it honest rather than merely quiet: a selector or media
   condition it cannot parse is a REFUSAL, never a skip; and finding zero
   buttons is a REFUSAL, because a check that passes because it measured
   nothing is the same failure wearing a green tick.
   ========================================================================== */
{
    const CASCADE_WIDTHS = [1600, 1280, 800, 390];
    const errors = [];
    const splitTop = (s) => {
        const list = []; let depth = 0, cur = "";
        for (const ch of s) {
            if (ch === "(") depth++; else if (ch === ")") depth--;
            if (ch === "," && depth === 0) { list.push(cur); cur = ""; continue; }
            cur += ch;
        }
        if (cur.trim()) list.push(cur);
        return list;
    };
    const rules = [];
    const collect = (css, media) => {
        let i = 0;
        while (i < css.length) {
            const open = css.indexOf("{", i);
            if (open < 0) break;
            const prelude = css.slice(i, open).trim();
            let depth = 1, j = open + 1;
            while (j < css.length && depth) { const c = css[j]; if (c === "{") depth++; else if (c === "}") depth--; j++; }
            const body = css.slice(open + 1, j - 1);
            i = j;
            if (prelude.startsWith("@")) {
                if (/^@media\b/i.test(prelude)) collect(body, media.concat([prelude.replace(/^@media/i, "").trim()]));
                else if (!/^@(keyframes|-webkit-keyframes|font-face|page|charset|import|namespace|supports)\b/i.test(prelude)) errors.push(`unsupported at-rule "${prelude.slice(0, 40)}"`);
                continue;
            }
            for (const d of body.split(";")) {
                const k = d.indexOf(":");
                if (k < 0) continue;
                const prop = d.slice(0, k).trim().toLowerCase();
                if (prop !== "color" && !prop.startsWith("--")) continue;
                let val = d.slice(k + 1).trim();
                const important = /!important$/i.test(val);
                if (important) val = val.replace(/!important$/i, "").trim();
                for (const sel of splitTop(prelude)) rules.push({ sel: sel.trim(), prop, val, important, media, order: rules.length });
            }
        }
    };
    const styleText = [...landing.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
    if (!styleText.trim()) errors.push("the artifact carries no <style> block");
    collect(styleText.replace(/\/\*[\s\S]*?\*\//g, ""), []);

    const STATE = new Set(["hover", "focus", "focus-visible", "focus-within", "active", "visited", "link", "target", "checked", "disabled", "enabled", "any-link", "invalid", "valid", "required", "placeholder-shown"]);
    const parseCompound = (s) => {
        const c = { tag: null, id: null, classes: [], attrs: [], nots: [], state: false, pseudoEl: false, spec: [0, 0, 0], bad: null };
        const bump = (a, b, d) => { c.spec[0] += a; c.spec[1] += b; c.spec[2] += d; };
        let i = 0;
        while (i < s.length) {
            const rest = s.slice(i); let m;
            if (rest[0] === "*") { i++; continue; }
            if ((m = /^\.([\w-]+)/.exec(rest))) { c.classes.push(m[1]); bump(0, 1, 0); i += m[0].length; continue; }
            if ((m = /^#([\w-]+)/.exec(rest))) { c.id = m[1]; bump(1, 0, 0); i += m[0].length; continue; }
            if (rest[0] === "[") {
                const j = s.indexOf("]", i);
                if (j < 0) { c.bad = `unterminated [ in "${s}"`; break; }
                const am = /^([\w:-]+)\s*(?:([~^$*|]?=)\s*(.*))?$/.exec(s.slice(i + 1, j).trim());
                if (!am) { c.bad = `unreadable attribute selector in "${s}"`; break; }
                if (am[2] && am[2] !== "=") { c.bad = `unsupported attribute operator ${am[2]}`; break; }
                c.attrs.push([am[1].toLowerCase(), am[3] == null ? null : am[3].trim().replace(/^["']|["']$/g, "")]);
                bump(0, 1, 0); i = j + 1; continue;
            }
            if (rest.startsWith("::")) { c.pseudoEl = true; break; }
            if (rest[0] === ":") {
                m = /^:([\w-]+)/.exec(rest);
                if (!m) { c.bad = `unreadable pseudo in "${s}"`; break; }
                const name = m[1].toLowerCase();
                let arg = null, len = m[0].length;
                if (rest[len] === "(") {
                    let d = 1, k = len + 1;
                    while (k < rest.length && d) { if (rest[k] === "(") d++; else if (rest[k] === ")") d--; k++; }
                    arg = rest.slice(len + 1, k - 1); len = k;
                }
                if (name === "not") {
                    if (arg == null) { c.bad = ":not() with no argument"; break; }
                    const inner = splitTop(arg).map((x) => parseCompound(x.trim()));
                    const bad = inner.find((x) => x.bad);
                    if (bad) { c.bad = bad.bad; break; }
                    c.nots.push(inner);
                    const rank = (x) => x.spec[0] * 1e4 + x.spec[1] * 1e2 + x.spec[2];
                    const w = inner.reduce((a, x) => (rank(x) > rank(a) ? x : a), inner[0]);
                    bump(w.spec[0], w.spec[1], w.spec[2]);
                } else if (STATE.has(name)) { c.state = true; bump(0, 1, 0); }
                else if (name === "root") { c.tag = "html"; bump(0, 1, 0); }
                else if (["before", "after", "selection", "marker", "placeholder", "first-line", "first-letter", "first-of-type"].includes(name)) { c.pseudoEl = true; }
                else { c.bad = `unsupported pseudo-class :${name}`; break; }
                i += len; continue;
            }
            if ((m = /^[\w-]+/.exec(rest))) { c.tag = m[0].toLowerCase(); bump(0, 0, 1); i += m[0].length; continue; }
            c.bad = `unreadable at "${rest.slice(0, 12)}" in "${s}"`; break;
        }
        return c;
    };
    const parseSelector = (sel) => {
        const parts = sel.trim().split(/\s*([>+~])\s*|\s+/).filter((x) => x != null && x !== "");
        const chainSel = []; let child = false;
        for (const p of parts) {
            if (p === ">") { child = true; continue; }
            if (p === "+" || p === "~") return { bad: `unsupported combinator ${p} in "${sel}"` };
            const c = parseCompound(p);
            if (c.bad) return { bad: c.bad };
            chainSel.push({ c, child }); child = false;
        }
        if (!chainSel.length) return { bad: `empty selector "${sel}"` };
        return {
            chainSel,
            spec: chainSel.reduce((a, x) => [a[0] + x.c.spec[0], a[1] + x.c.spec[1], a[2] + x.c.spec[2]], [0, 0, 0]),
            state: chainSel.some((x) => x.c.state),
            pseudoEl: chainSel.some((x) => x.c.pseudoEl),
        };
    };
    const matchCompound = (c, el) => {
        if (c.tag && c.tag !== el.tag) return false;
        if (c.id && c.id !== el.id) return false;
        for (const k of c.classes) if (!el.cls.has(k)) return false;
        for (const [a, v] of c.attrs) { if (!(a in el.attrs)) return false; if (v != null && el.attrs[a] !== v) return false; }
        for (const g of c.nots) if (g.some((n) => matchCompound(n, el))) return false;
        return true;
    };
    const matchChain = (chainSel, chain) => {
        let ci = chain.length - 1, si = chainSel.length - 1;
        if (!matchCompound(chainSel[si].c, chain[ci])) return false;
        let child = chainSel[si].child; si--; ci--;
        while (si >= 0) {
            if (ci < 0) return false;
            if (child) {
                if (!matchCompound(chainSel[si].c, chain[ci])) return false;
                child = chainSel[si].child; si--; ci--;
            } else {
                let hit = -1;
                for (let k = ci; k >= 0; k--) if (matchCompound(chainSel[si].c, chain[k])) { hit = k; break; }
                if (hit < 0) return false;
                child = chainSel[si].child; si--; ci = hit - 1;
            }
        }
        return true;
    };

    const VOID = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
    const scrubbed = landing
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "<style></style>")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "<script></script>")
        .replace(/<!--[\s\S]*?-->/g, "");
    const stack = [], btns = [];
    for (const m of scrubbed.matchAll(/<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g)) {
        const tag = m[2].toLowerCase();
        if (m[1] === "/") { for (let k = stack.length - 1; k >= 0; k--) if (stack[k].tag === tag) { stack.length = k; break; } continue; }
        const attrs = {};
        for (const a of m[3].matchAll(/([\w:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? "";
        const el = { tag, attrs, id: attrs.id || "", cls: new Set((attrs.class || "").trim().split(/\s+/).filter(Boolean)) };
        const chain = stack.concat([el]);
        if (el.cls.has("btn")) btns.push(chain);
        if (!VOID.has(tag) && m[4] !== "/") stack.push(el);
    }

    const mediaHolds = (conds, w) => conds.every((q) => q.split(/\s+and\s+/i).every((c) => {
        const t = c.trim().replace(/^\(|\)$/g, "");
        let m;
        if ((m = /^max-width\s*:\s*(\d+)px$/i.exec(t))) return w <= Number(m[1]);
        if ((m = /^min-width\s*:\s*(\d+)px$/i.exec(t))) return w >= Number(m[1]);
        if (/^prefers-reduced-motion/i.test(t)) return false;
        if (/^(screen|all|print)$/i.test(t)) return !/print/i.test(t);
        errors.push(`unsupported media condition (${t})`);
        return false;
    }));

    const parsed = rules.map((r) => ({ ...r, p: parseSelector(r.sel) }));
    for (const r of parsed) if (r.p.bad) errors.push(r.p.bad);
    const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };
    const declKey = (r) => [r.important ? 1 : 0, ...r.p.spec, r.order];
    const winner = (chain, prop, w, only) => {
        let best = null;
        for (const r of parsed) {
            if (r.prop !== prop || r.p.bad || r.p.state || r.p.pseudoEl) continue;
            if (only && !only(r)) continue;
            if (!mediaHolds(r.media, w) || !matchChain(r.p.chainSel, chain)) continue;
            const key = declKey(r);
            if (!best || cmp(key, best.key) > 0) best = { r, key };
        }
        return best;
    };
    const resolve = (chain, value, w, depth = 0) => {
        if (depth > 12) return value;
        const v = String(value).trim();
        if (v === "inherit") {
            const up = chain.slice(0, -1);
            if (!up.length) return "(initial)";
            const win = winner(up, "color", w);
            return win ? resolve(up, win.r.val, w, depth + 1) : resolve(up, "inherit", w, depth + 1);
        }
        const m = /^var\(\s*(--[\w-]+)\s*(?:,([\s\S]*))?\)$/.exec(v);
        if (m) {
            for (let k = chain.length; k > 0; k--) {
                const win = winner(chain.slice(0, k), m[1], w);
                if (win) return resolve(chain.slice(0, k), win.r.val, w, depth + 1);
            }
            return m[2] != null ? resolve(chain, m[2].trim(), w, depth + 1) : "(unset)";
        }
        return v;
    };
    const norm = (v) => {
        const s = String(v).trim().toLowerCase();
        let m = /^#([0-9a-f]{3})$/.exec(s);
        if (m) return `rgba(${parseInt(m[1][0] + m[1][0], 16)},${parseInt(m[1][1] + m[1][1], 16)},${parseInt(m[1][2] + m[1][2], 16)},1)`;
        m = /^#([0-9a-f]{6})$/.exec(s);
        if (m) return `rgba(${parseInt(m[1].slice(0, 2), 16)},${parseInt(m[1].slice(2, 4), 16)},${parseInt(m[1].slice(4, 6), 16)},1)`;
        m = /^rgba?\(([^)]*)\)$/.exec(s);
        if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return `rgba(${p[0]},${p[1]},${p[2]},${p.length > 3 ? p[3] : 1})`; }
        return s;
    };
    const computed = (chain, w) => {
        for (let k = chain.length; k > 0; k--) {
            const sub = chain.slice(0, k);
            const inline = sub[sub.length - 1].attrs.style;
            if (inline && /(^|;)\s*color\s*:/i.test(inline)) return { v: resolve(sub, /(?:^|;)\s*color\s*:([^;]+)/i.exec(inline)[1], w), from: "the style attribute" };
            const win = winner(sub, "color", w);
            if (win) return { v: resolve(sub, win.r.val, w), from: win.r.sel + (k === chain.length ? "" : " (inherited)") };
        }
        return { v: "(initial)", from: "(initial)" };
    };

    T("the cascade resolver read every rule in the artifact", errors.length === 0,
        errors.length ? [...new Set(errors)].slice(0, 4).join(" | ") : `${parsed.length} colour/custom-property declarations`);
    T("the artifact actually has buttons to check", btns.length > 0,
        "a check that measured nothing is not a check that passed");

    let loser = null;
    for (const w of CASCADE_WIDTHS) for (const chain of btns) {
        const el = chain[chain.length - 1];
        const decl = winner(chain, "color", w, (r) => r.p.chainSel[r.p.chainSel.length - 1].c.classes.includes("btn"));
        const got = computed(chain, w);
        const want = decl ? resolve(chain, decl.r.val, w) : null;
        const where = chain.some((a) => a.cls.has("top")) && chain.some((a) => a.tag === "nav") ? "header" : "body";
        const id = `${el.tag}.${[...el.cls].join(".")} in the ${where}` +
            (el.attrs.href ? ` → ${el.attrs.href}` : el.attrs.type ? ` [type=${el.attrs.type}]` : "");
        const ok = !!decl && norm(got.v) === norm(want);
        if (!ok && !loser) loser = `${id} at ${w}px computes ${got.v} from "${got.from}"`;
        T(`computed colour @${w}px — ${id}`, ok,
            !decl ? "no .btn rule declares a colour for it"
                : ok ? `${got.v}, from "${got.from}"`
                    : `computes ${got.v} from "${got.from}" — but ${decl.r.sel} declares ${want}`);
    }
    T("no button loses its declared colour to the cascade at any width", loser === null,
        loser || `${btns.length} button(s) × ${CASCADE_WIDTHS.length} widths, every one painting what its rule declares`);
}

/* ==========================================================================
   17. THE CORRECTION FORM — SHELL.md r9, ruled by Travis 2026-08-17

   The endpoint is the one computedriven.com posts to, and what is checked is
   the SHAPE, because the shape is what makes the form honest rather than
   decorative: a real action that posts with scripting off, the honeypot (which
   fails SILENTLY when it is dropped in a refactor — nothing breaks, the spam
   just arrives), the live region on the reply, and an enhancement that prints
   success only on an actual 2xx.

   It is pointed on this surface. Every runtime claim here was unbacked and is
   now retracted in place; a form that asks the reader for a number of ours
   they think is wrong is the right companion to that.
   ========================================================================== */
{
    const formM = /<form\b([^>]*)>([\s\S]*?)<\/form>/i.exec(landing);
    T("the page carries a correction form", !!formM, "SHELL.md r9 requires one on every surface");
    const attrs = formM ? formM[1] : "";
    const body = formM ? formM[2] : "";
    const action = (/\baction="([^"]*)"/.exec(attrs) || [])[1];

    T("the form posts to the endpoint the record declares", action === ENDPOINT,
        `form action ${JSON.stringify(action)}, record declares ${JSON.stringify(ENDPOINT)}`);
    T("the endpoint the record declares is the ruled one", ENDPOINT === "https://formspree.io/f/xaewoadr", ENDPOINT);
    T("the form posts on its own, without JavaScript",
        /\bmethod="POST"/i.test(attrs) && !/\bonsubmit=/i.test(attrs), `attributes: ${attrs.trim()}`);
    T("the form carries novalidate, so the reply is ours to print", /\bnovalidate\b/i.test(attrs));
    T("the _gotcha honeypot is present", /name="_gotcha"/.test(body),
        "a honeypot dropped in a refactor fails silently — nothing breaks, the spam just arrives");
    T("the honeypot is hidden off-screen, not display:none",
        /\.say input\[name=_gotcha\]\{[^}]*left:-9999px/.test(landing),
        "some bots skip anything a stylesheet has explicitly hidden");
    T("the honeypot is out of the tab order and out of the a11y tree",
        /name="_gotcha"[^>]*tabindex="-1"/.test(body) && /name="_gotcha"[^>]*aria-hidden="true"/.test(body));
    T("the form asks for a reply address and a message",
        /name="email"[^>]*required/.test(body) && /<textarea[^>]*name="message"[^>]*required/.test(body));
    T("the message field keeps the placeholder that invites a correction",
        /a number of ours you think is wrong/.test(body));
    T("the reply paragraph is announced to a screen reader",
        /class="say-msg"[^>]*role="status"[^>]*aria-live="polite"/.test(body),
        "the outcome of a submit is invisible without it");
    T("the submit control is a real submit button", /<button[^>]*type="submit"[^>]*class="btn"/.test(body));
    T("the inline reply prints success only on a real 2xx",
        /if\s*\(res\.ok\)/.test(sayJs) && !/say\(\s*"Sent/.test(sayJs.split("if (res.ok)")[0]),
        "src/say.js would be saying sent before the endpoint had answered");
    T("the inline reply is external and deferred, so the form survives it failing",
        landing.includes('<script src="/say.js" defer></script>'));
    T("a second correction route is offered beside the form", landing.includes(surface.contact.issues));
}

console.log(`\n${pass} passed, ${fail} failed (publication gate)`);
if (fail) process.exit(1);
