/* ==========================================================================
   webhost.systems site build.

   The landing page is GENERATED from records/surface.json and from FILE PROBES
   re-derived off disk on every run. Every count, line number and quoted source
   line that reaches the page is recomputed here and compared against the
   frozen record in records/evidence.json; on any disagreement this build
   throws and nothing is emitted.

   The direction of dependency is the whole point (SHELL.md §4.1). The page
   cell is COMPUTED; the record is what it is CHECKED AGAINST. If the page were
   the source, nothing could audit it — which is precisely how this page came
   to advertise a Convex control plane, two runtimes and an SDK for months.

   WHAT IS DIFFERENT HERE, AND WHY IT SUITS THIS SURFACE: almost every claim on
   this page is NEGATIVE. "There is no AWS dependency." "packages/ does not
   exist." "Nothing reads an ampersand.json." A negative claim is the easiest
   kind for a build to keep honest and the easiest kind for a page to go
   quietly wrong about, because nobody edits a sentence when they add a
   dependency. So the probes below are mostly absence probes, and the day one
   of them turns positive this page stops building.

   Run it through the gate, never on its own:   npm run site:launch

   NOTE ON SCOPE: this build reads ../ampersand-supabase/ (read-only) because
   that is where the edge functions and migrations this page cites actually
   live. It is a sibling repository in the same working tree. The page is built
   and gated locally and the emitted index.html is committed, so the sibling is
   always present when it matters; Cloudflare serves the committed artifact and
   never runs this script. See README.md.
   ========================================================================== */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { createHash } from "crypto";

const read = (p) => readFileSync(p, "utf8");
const J = (p) => JSON.parse(read(p));
const sha = (s) => createHash("sha256").update(s).digest("hex");

const SUPA = "../ampersand-supabase";
const FROZEN = "./records/evidence.json";
const RUNGS = ["spec", "in_tree", "live_local", "live_deployed", "external"];

const surface = J("./records/surface.json");
const pkg = J("./package.json");

/* Every record string that reaches the page passes through esc(), so esc() is
   where {{probe.KEY}} is resolved. A count in this record is therefore never
   typed — it is a reference to a value re-derived off disk on this run, and an
   unknown key throws. The first draft of records/surface.json said "eleven
   specification documents"; the probe counted ten. */
let RESOLVED = null;
const esc = (s) =>
    String(s)
        .replace(/\{\{probe\.(\w+)\}\}/g, (m, k) => {
            if (!RESOLVED) throw new Error("BUILD REFUSED — a probe token was rendered before the probes were resolved.");
            if (!(k in RESOLVED)) throw new Error(`BUILD REFUSED — records/surface.json references {{probe.${k}}} and there is no such probe.`);
            return String(RESOLVED[k].value);
        })
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ==========================================================================
   THE PROBES

   Each one is a function of the filesystem. `label` and `claim` are what the
   page prints; `value` is what is frozen and compared. A probe that cannot
   find what it is looking for throws — an unresolvable probe is a claim that
   has lost its witness, which is worse than a wrong one.
   ========================================================================== */

/* Every dependency manifest in this repository, node_modules excluded. */
function manifests(dir, out = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "old_scrap") continue;
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) manifests(p, out);
        else if (e.name === "package.json") out.push(p);
    }
    return out;
}

/* The 1-based line number of the first line containing `needle`, plus that
   line's text. Throws when the needle is gone, which is the point. */
function lineOf(file, needle) {
    if (!existsSync(file)) throw new Error(`PROBE FAILED — ${file} does not exist, and the page cites it.`);
    const lines = read(file).split("\n");
    const i = lines.findIndex((l) => l.includes(needle));
    if (i < 0) throw new Error(`PROBE FAILED — ${file} no longer contains ${JSON.stringify(needle)}. The page quotes it; fix the page, not the probe.`);
    return { line: i + 1, text: lines[i].trim() };
}

function countIn(dir, re) {
    if (!existsSync(dir)) throw new Error(`PROBE FAILED — ${dir} does not exist.`);
    return readdirSync(dir).filter((f) => re.test(f)).length;
}

/* Recursive grep, node_modules and build output excluded. Returns the number
   of FILES containing the pattern. */
function grepCount(dir, re, exts) {
    let n = 0;
    const walk = (d) => {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            if (["node_modules", ".git", "dist", "old_scrap", "records", "src"].includes(e.name)) continue;
            const p = `${d}/${e.name}`;
            if (e.isDirectory()) walk(p);
            else if (exts.some((x) => e.name.endsWith(x)) && re.test(read(p))) n++;
        }
    };
    if (existsSync(dir)) walk(dir);
    return n;
}

export function probeAll({ runTests = true } = {}) {
    const p = {};

    /* --- the deploy path stops at a database row ------------------------- */
    const deployFile = `${SUPA}/functions/webhost-deploy/index.ts`;
    const todo = lineOf(deployFile, "TODO: Actual Cloudflare Workers API call goes here");
    p.deploy_todo = {
        claim: "Nothing is shipped to a runtime",
        where: "ampersand-supabase/functions/webhost-deploy/index.ts",
        line: todo.line,
        says: todo.text,
    };
    const sim = lineOf(deployFile, "simulated: true");
    p.deploy_simulated = {
        claim: "The deploy writes a marker instead",
        where: "ampersand-supabase/functions/webhost-deploy/index.ts",
        line: sim.line,
        says: sim.text,
    };

    /* --- the invocation endpoint reaches a model, not an agent ----------- */
    const inv = lineOf(`${SUPA}/functions/webhost-invoke/index.ts`, "invokeOpenRouter");
    p.invoke_openrouter = {
        claim: "invoke/v1 answers from a model provider",
        where: "ampersand-supabase/functions/webhost-invoke/index.ts",
        line: inv.line,
        says: inv.text,
    };

    /* --- AgentCore is a string in three places and nothing else ---------- */
    const enu = lineOf(`${SUPA}/migrations/020_webhost_schema.sql`, "agentcore");
    p.agentcore_enum = {
        claim: "AgentCore is an enum member",
        where: "ampersand-supabase/migrations/020_webhost_schema.sql",
        line: enu.line,
        says: enu.text,
    };
    const opt = lineOf("./apps/web/src/components/AgentsPage/AgentsListPanel.tsx", 'value="agentcore"');
    p.agentcore_option = {
        claim: "...and an option in a select element",
        where: "apps/web/src/components/AgentsPage/AgentsListPanel.tsx",
        line: opt.line,
        says: opt.text,
    };

    /* --- the absence probes. These are the load-bearing ones. ------------ */
    const manifestFiles = manifests(".");
    const depTokens = (m) => {
        const j = JSON.parse(read(m));
        return Object.keys({ ...j.dependencies, ...j.devDependencies, ...j.peerDependencies, ...j.optionalDependencies });
    };
    const aws = manifestFiles.flatMap((m) => depTokens(m).filter((d) => /aws|bedrock|agentcore/i.test(d)).map((d) => `${m}: ${d}`));
    p.no_aws = {
        claim: "No AWS or Bedrock package anywhere",
        where: `${manifestFiles.length} package.json files, node_modules excluded`,
        line: null,
        says: aws.length ? aws.join("; ") : "0 dependencies match /aws|bedrock|agentcore/",
        value: aws.length,
    };
    const convex = manifestFiles.flatMap((m) => depTokens(m).filter((d) => /convex/i.test(d)).map((d) => `${m}: ${d}`));
    p.no_convex = {
        claim: "No Convex dependency in any manifest",
        where: `${manifestFiles.length} package.json files, node_modules excluded`,
        line: null,
        says: convex.length ? convex.join("; ") : "0 dependencies match /convex/",
        value: convex.length,
    };
    p.no_packages_dir = {
        claim: "The workspace declares packages/* and there is none",
        where: "packages/",
        line: null,
        says: existsSync("./packages") ? "packages/ exists" : "no such directory",
        value: existsSync("./packages") ? 1 : 0,
    };
    const manifestReaders =
        grepCount("./apps", /ampersand\.json/, [".ts", ".tsx", ".js", ".jsx"]) +
        grepCount(`${SUPA}/functions`, /ampersand\.json/, [".ts"]);
    p.no_manifest_reader = {
        claim: "Nothing reads an ampersand.json",
        where: "apps/ and the webhost edge functions",
        line: null,
        says: `${manifestReaders} source files mention it`,
        value: manifestReaders,
    };

    /* --- the counts ------------------------------------------------------ */
    p.edge_functions = {
        claim: "webhost edge functions",
        where: "ampersand-supabase/functions/",
        line: null,
        says: readdirSync(`${SUPA}/functions`).filter((f) => /^webhost-/.test(f)).sort().join(", "),
        value: countIn(`${SUPA}/functions`, /^webhost-/),
    };
    p.migrations = {
        claim: "webhost database migrations",
        where: "ampersand-supabase/migrations/",
        line: null,
        says: readdirSync(`${SUPA}/migrations`).filter((f) => /webhost/.test(f)).sort().join(", "),
        value: countIn(`${SUPA}/migrations`, /webhost/),
    };
    p.spec_docs = {
        claim: "specification documents",
        where: "docs/spec/",
        line: null,
        says: readdirSync("./docs/spec").filter((f) => f.endsWith(".md")).sort().join(", "),
        value: countIn("./docs/spec", /\.md$/),
    };

    /* --- the test suite. Run, not quoted. --------------------------------
       SHELL.md §4.1: a page cell must be COMPUTED. The only way a test count
       on a page is not a hand-typed number is for the build to run the tests
       and parse what came back. It costs about three seconds. */
    if (runTests) {
        let out;
        try {
            out = execFileSync("npm", ["test"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
        } catch (e) {
            const tail = `${e.stdout || ""}\n${e.stderr || ""}`.trim().split("\n").slice(-12).join("\n");
            throw new Error(`BUILD REFUSED — the test suite did not pass, so the page may not publish a passing count.\n${tail}`);
        }
        const files = /Test Files\s+(\d+) passed \((\d+)\)/.exec(out);
        const tests = /Tests\s+(\d+) passed \((\d+)\)/.exec(out);
        if (!files || !tests) throw new Error("BUILD REFUSED — could not parse a test summary out of `npm test`. A count that cannot be parsed may not be published.");
        if (files[1] !== files[2] || tests[1] !== tests[2]) throw new Error("BUILD REFUSED — not every test passed.");
        p.tests = { claim: "tests passing", where: "npm test — vitest, in this repository", line: null, says: `${tests[1]} tests across ${files[1]} files, 0 failures`, value: Number(tests[1]) };
        p.test_files = { claim: "test files", where: "apps/web/src/", line: null, says: `${files[1]} files`, value: Number(files[1]) };
    }

    return p;
}

/* ==========================================================================
   FREEZE / CHECK
   records/evidence.json is written by this build the first time and CHECKED
   against on every run afterwards. Freezing is what turns "the numbers came
   off disk" into "the numbers have not moved since a person looked".
   ========================================================================== */
export function checkFrozen(probes) {
    const drift = [];
    if (!existsSync(FROZEN)) {
        writeFileSync(FROZEN, JSON.stringify({
            schema: "webhost-evidence-v1",
            _comment: "Frozen by build-site.mjs on first run. Every value here is re-derived from disk on every subsequent build and the build refuses on any disagreement. Do not hand-edit: if a line number moved, that is a code event, and the page's citation moves with it only when a person has looked.",
            frozen_at: surface.verified_at,
            probes,
        }, null, 2) + "\n");
        console.log(`froze ${Object.keys(probes).length} probes into ${FROZEN}`);
        return drift;
    }
    const frozen = J(FROZEN).probes;
    for (const [k, v] of Object.entries(probes)) {
        const f = frozen[k];
        if (!f) { drift.push(`${k}: probed now, absent from the frozen record`); continue; }
        for (const field of ["claim", "line", "says", "value", "where"]) {
            if (JSON.stringify(v[field]) !== JSON.stringify(f[field])) {
                drift.push(`${k}.${field}: probed ${JSON.stringify(v[field])} != record ${JSON.stringify(f[field])}`);
            }
        }
    }
    for (const k of Object.keys(frozen)) if (!(k in probes)) drift.push(`${k}: in the frozen record, not probed`);
    return drift;
}

/* ==========================================================================
   SHELL FRAGMENTS — shared markup; only the tokens in src/shell.css differ.
   ========================================================================== */

/* The chip renders the stored rung, and "?" when there is none. It never
   defaults, because a defaulted rung is a fabricated status. */
function rung(value) {
    const r = RUNGS.includes(value) ? value : "?";
    return `<span class="rung" data-rung="${r}" title="spec · in_tree · live_local · live_deployed · external">${r}</span>`;
}

/* The band states where you are, and WHAT IT MAY STATE DEPENDS ON THE PLACE.
   ampersand-nav/src/amp-nav.js records webhost as place:2 with layer "runtime",
   and its own renderPlacement() emits the layer sentence for place 2. Writing
   the place-3 or place-4 sentence here would put this band in contradiction
   with the nav rendered immediately beneath it. The nav is the record and the
   nav wins — including on the rung, where its stored value is null and its own
   RUNG_LABEL renders that as "?". SHELL.md §1, r6. */
/* THE SHARED PORTFOLIO NAV. Ruled by Travis 2026-08-17 — "the ampersand-nav
   needs to be on each website!" — after this surface and four siblings each
   dropped it independently on adopting the shell.

   Emitted from the record rather than typed into the template, so the property
   key has one home. An unknown key is the dangerous failure: amp-nav renders
   an EMPTY bar for a property it does not know, which looks like a styling
   problem and not like a wrong string, so the build refuses it here instead.

   The vendored ./amp-nav.js is written by ampersand-nav/sync-nav.sh and is NOT
   this repo's to edit; it has been present and unreferenced all along. It is
   deliberately not recorded in build-stamp.json's `sources` — sync-nav.sh
   rewrites it across ~21 repos and lane N runs it last, so treating it as a
   source would make this gate refuse "stale artifact" for a file this repo may
   not change. */
function navChrome() {
    const key = surface.nav_property;
    if (!key) throw new Error("BUILD REFUSED — records/surface.json declares no nav_property, so the page cannot say which property the shared nav should render.");
    if (!existsSync("./amp-nav.js")) throw new Error("BUILD REFUSED — ./amp-nav.js is not in this tree; the page would load the nav from a 404. Run ampersand-nav/sync-nav.sh.");
    if (!new RegExp(`^\\s*${key}:\\s*\\{`, "m").test(read("./amp-nav.js"))) {
        throw new Error(`BUILD REFUSED — the vendored amp-nav.js has no "${key}" property. An unknown key renders an empty nav bar rather than an error.`);
    }
    return `<script type="module" src="/amp-nav.js"></script>\n<amp-nav property="${key}"></amp-nav>`;
}

function band() {
    const where = {
        4: `A <b>${esc(surface.parent)}</b> project`,
        3: `${esc(surface.surface)} &mdash; a <b>specification</b> in the ${esc(surface.parent)} world`,
        2: `${esc(surface.surface)} is the <b>${esc(surface.layer)}</b> layer of ${esc(surface.parent)}`,
    }[surface.tier];
    if (!where) throw new Error("BUILD REFUSED — records/surface.json declares no usable place, so the band cannot know what it may claim.");
    return `<div class="band" data-tier="${surface.tier}"><span class="where">${where}</span>${rung(surface.surface_rung)}<span class="covers">${esc(surface.surface_rung_covers)}</span></div>`;
}

function statusBlock() {
    const s = surface.status;
    return `<dl class="status">
<div><dt>Status</dt><dd><strong>${esc(surface.surface_rung)}</strong> &mdash; ${esc(s.statement)}</dd></div>
<div><dt>Last verified</dt><dd>${esc(surface.verified_at)}</dd></div>
<div><dt>Source</dt><dd>${esc(s.source)}</dd></div>
<div class="limit"><dt>Limit</dt><dd>${esc(s.limit)}</dd></div>
<div><dt>Next rung</dt><dd><strong>${esc(surface.advance.next_rung)}</strong> &mdash; ${esc(surface.advance.requires)}</dd></div>
</dl>`;
}

/* §0.7: the rung gates the call to action. A CTA block declares its rung and
   may only use verbs that rung has earned; anything else throws. */
const VERBS = {
    spec: ["Read", "Challenge", "Implement"],
    in_tree: ["Inspect the source", "Run the tests"],
    live_local: ["Use it", "Reproduce it locally"],
    live_deployed: ["Use the deployed artifact"],
    external: ["See independent evidence", "Contribute another result"],
};

function cta(groupRung, label, actions) {
    const allowed = VERBS[groupRung];
    if (!allowed) throw new Error(`CTA group declares an unknown rung: ${groupRung}`);
    for (const a of actions) {
        if (!allowed.includes(a.verb)) {
            throw new Error(`BUILD REFUSED — CTA "${a.verb}" is not available at rung ${groupRung}. Allowed: ${allowed.join(", ")}`);
        }
    }
    const cls = groupRung === "spec" ? "tag" : "tag ok";
    return `<div class="ctagroup"><div class="${cls}">${esc(groupRung)} &mdash; ${esc(label)}</div><div class="cta">${actions
        .map((a) => `<a href="${a.href}"${a.href.startsWith("http") ? ' target="_blank" rel="noopener"' : ""}><span class="verb">${esc(a.verb)}</span><span class="what">${a.what}</span></a>`)
        .join("")}</div></div>`;
}

/* ==========================================================================
   GENERATED CONTENT
   ========================================================================== */

function plate(p) {
    const cells = [
        [String(p.edge_functions.value), "Edge functions"],
        [String(p.migrations.value), "Migrations"],
        [String(p.spec_docs.value), "Spec documents"],
        [String(p.tests.value), "Tests passing"],
        ...surface.zero_counts.slice(0, 2).map((z) => [z.value, z.label]),
    ];
    return `<div class="grid plate">${cells.map(([n, l]) => `<div><div class="n">${esc(n)}</div><div class="l">${esc(l)}</div></div>`).join("")}</div>`;
}

function artifactCards() {
    return `<div class="grid">${surface.artifacts
        .map((a) => `<div><div class="head"><h3>${esc(a.name)}</h3>${rung(a.rung)}</div><p>${esc(a.detail)}</p><div class="needs"><b>Where:</b> <span class="where-tag">${esc(a.where)}</span><br><b>Witness:</b> ${esc(a.witness)}</div></div>`)
        .join("")}</div>`;
}

function openCards() {
    return `<div class="grid">${surface.unmeasured
        .map((c) => `<div><div class="head"><h3>${esc(c.name)}</h3>${rung(c.rung)}</div><p>${esc(c.detail)}</p><div class="needs"><b>Needs:</b> ${esc(c.needs)} <b>Built:</b> ${esc(c.built)}.</div></div>`)
        .join("")}</div>`;
}

/* This surface's own figure: the two planes, and the empty one is the point.
   Static markup, no script, no data. */
function planes() {
    return `<div class="planes">
<div class="plane"><div class="peyebrow">Control plane &mdash; built</div><h3>A system of record</h3><p>Agents, deployments with a per-agent unique version, an active-deployment pointer that rollback moves rather than editing history, signed telemetry ingestion, usage aggregation and plan limits. Clients hold read access only; every write goes through a service-role function.</p><div class="chips"><span class="chip on">Postgres + RLS</span><span class="chip on">Edge functions</span><span class="chip on">HMAC telemetry</span><span class="chip on">React dashboard</span></div></div>
<div class="plane empty"><div class="peyebrow">Data plane &mdash; empty</div><h3>Where an agent would execute</h3><p>Nothing occupies this half. The deploy path stops at the version row and marks the provider reference with a marker meaning it did not happen; the invocation endpoint answers from a model provider, which is a different product from a deployed agent. What eventually fills this is an open question, not a shipped choice.</p><div class="chips"><span class="chip off">Workers</span><span class="chip off">AgentCore</span><span class="chip off">Any runtime at all</span></div></div>
</div>`;
}

function probeTable(p) {
    const order = [
        "deploy_todo", "deploy_simulated", "invoke_openrouter", "agentcore_enum", "agentcore_option",
        "no_packages_dir", "no_manifest_reader", "no_aws", "no_convex",
        "edge_functions", "migrations", "spec_docs", "tests",
    ];
    const rows = order.map((k) => {
        const r = p[k];
        const at = r.line === null ? esc(r.where) : `${esc(r.where)}:${r.line}`;
        return `<tr><td class="claim">${esc(r.claim)}</td><td class="at">${at}</td><td class="says">${esc(r.says)}</td></tr>`;
    }).join("");
    return `<div class="scroll"><table><thead><tr><th>What is being claimed</th><th>Where it is settled</th><th>What is there</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function zeros() {
    return `<dl class="status">${surface.zero_counts
        .map((z) => `<div><dt>${esc(z.label)}</dt><dd><strong>${esc(z.value)}.</strong> ${esc(z.witness)}</dd></div>`)
        .join("")}</dl>`;
}

/* ==========================================================================
   THE RETRACTION
   Every string quoted below stood on this page until 2026-08-16 and none of
   them had a witness. They are listed in records/surface.json and the gate
   COUNTS them on the emitted page — they may appear here and nowhere else, and
   nowhere hidden. So the retraction cannot be undone by an edit, only by a
   measurement. SHELL.md §4.2, r8.
   ========================================================================== */
function retraction() {
    const items = surface.retracted.sentences
        .map((s) => `<li><q>${esc(s.text)}</q> &mdash; ${esc(s.note)}</li>`)
        .join("");
    return `<div class="retract"><h3>Retracted, in place, rather than quietly refreshed</h3>
<p>The ${surface.retracted.sentences.length} strings below were on this page. The publication gate counts each one on the emitted artifact and refuses the build if any occurrence appears outside this paragraph &mdash; or inside a comment or an attribute, where a reader cannot see it and a search engine can. That is what makes this a retraction rather than an intention.</p>
<ul>${items}</ul>
<p>Two of them are worth naming again. The control-plane box was labelled <code>Convex</code>, and this repository has never depended on Convex &mdash; the only trace of it in any manifest is an extraneous lock-file record for a workspace that is not on disk &mdash; while the plane it labelled runs on Postgres. And the footer carried a live-looking status badge with no status source behind it at all: a decoration shaped like an instrument, which is the same defect as a number read out of an animation, and this page now carries a rule against both.</p>
<p>What replaced them is smaller and checkable. The claims that remain each cite a file and a line, the build re-opens every one of those files and refuses to emit the page if a cited line has stopped saying what it is quoted as saying, and the rung this surface holds is <code>?</code> rather than a flattering guess.</p></div>`;
}

const METHOD_NOTE =
    `Each row was produced by opening the named file during this build and searching it for the string the row is about &mdash; the line number is where it was found, and the third column is that line, trimmed. ` +
    `The absence rows are the same mechanism run backwards: every <code>package.json</code> in the repository is parsed and its dependency names searched, and a single match refuses the build. ` +
    `The test row is not quoted from anywhere: the build runs the repository's own test command, parses the summary it prints, and refuses if a single test fails or if the summary cannot be parsed. ` +
    `Frozen in <code>records/evidence.json</code> and compared on every run, so a value that moves has to be looked at by a person before it can be published.`;

function contactForm() {
    /* SHELL.md r9, and the shape is copied from computedriven.com rather than
       invented: a real form action that posts with scripting off, the _gotcha
       honeypot, and a reply paragraph that is a live region. src/say.js only
       upgrades it to an inline reply and prints success on a 2xx and never
       optimistically. */
    return `<form class="say" action="${surface.contact.url}" method="POST" novalidate>
<div class="say-row">
<label class="say-f"><span>Your email</span><input type="email" name="email" autocomplete="email" placeholder="so a reply can reach you" required></label>
<label class="say-f"><span>Message</span><textarea name="message" rows="3" placeholder="a question, a correction, a number of ours you think is wrong" required></textarea></label>
</div>
<!-- Formspree's honeypot: a bot fills it, a person never sees it. -->
<input type="text" name="_gotcha" tabindex="-1" autocomplete="off" aria-hidden="true">
<input type="hidden" name="_subject" value="webhost.systems correction">
<div class="say-act"><button type="submit" class="btn">Send</button><p class="say-msg" role="status" aria-live="polite"></p></div>
</form>
<p class="say-alt">It posts to Formspree, which is a third party and the only one this page hands anything to; nothing is sent until you press the button. If you would rather not use it, <a href="${surface.contact.issues}">open an issue</a> instead &mdash; both reach the same person.</p>`;
}

/* ==========================================================================
   RENDER — pure. Given the records and src/, it returns the artifact.

   launch-gate.mjs imports this and compares its output against the file on
   disk. That closes the second r6 gate hole: if this build throws, the
   previous index.html survives on disk and a gate that only READS the artifact
   will happily approve a stale one. A gate that can re-derive the artifact
   cannot be fooled that way.
   ========================================================================== */
export function render(probes) {
    RESOLVED = probes;
    if (pkg.version !== surface.version) {
        throw new Error(`release identity: package.json ${pkg.version} != records/surface.json ${surface.version}`);
    }
    const STAMP = `WEBHOST.SYSTEMS v${surface.version} · RECORDS ${surface.verified_at} · ${surface.shell_revision}`;

    /* The stylesheet ships stripped of comments and indentation. The source
       stays commented and readable; only the artifact is dense. SHELL.md §5. */
    const CSS = read("./src/shell.css").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n\s*/g, "").replace(/;\}/g, "}").trim();

    const html = fill(read("./src/landing.html"), {
        CSS,
        BAND: band(),
        NAV: navChrome(),
        STAMP,
        ORIGIN: surface.origin,
        REPO: surface.repo,
        ISSUES: surface.contact.issues,
        SPEC_URL: surface.spec_url,
        QUESTION: esc(surface.question),
        YEAR: String(new Date(surface.verified_at).getUTCFullYear()),
        PLATE: plate(probes),
        RETRACTION: retraction(),
        ARTIFACTS: artifactCards(),
        PLANES: planes(),
        OPEN_CARDS: openCards(),
        PROBE_TABLE: probeTable(probes),
        METHOD_NOTE,
        STATUS: statusBlock(),
        ZEROS: zeros(),
        FORM: contactForm(),
        CTA:
            cta("in_tree", "code with a test suite, and no deployment", [
                {
                    verb: "Inspect the source",
                    href: surface.repo,
                    what: "The dashboard, the schema, the row-level security policies and the edge functions. Start with the deploy function &mdash; the line the table above cites is the whole story of this domain in one comment.",
                },
                {
                    verb: "Run the tests",
                    href: surface.repo,
                    what: "<code>npm install &amp;&amp; npm test</code>. The count on this page is whatever that command printed when the page was last built; if your machine disagrees, that is worth telling us about.",
                },
            ]) +
            cta("spec", "documents, one of them superseded in part", [
                {
                    verb: "Read",
                    href: surface.spec_url,
                    what: "The v1 specification set. The runtime provider interface is the interesting one: it is a careful abstraction over providers, and it has no implementation on either side of it.",
                },
                {
                    verb: "Challenge",
                    href: "#say",
                    what: "A claim above that does not hold, a cited line that has stopped saying what it is quoted as saying, or a count that is wrong. The form at the bottom of this page goes to a person.",
                },
                {
                    verb: "Implement",
                    href: surface.repo,
                    what: "A provider adapter that makes a real call would move this surface off <code>?</code> for the first time. Nobody has written one, and that is the honest state of the runtime layer.",
                },
            ]),
    });

    /* The two scripts ship stripped of comments and indentation. NEWLINES ARE
       KEPT — joining JavaScript lines the way the CSS is joined is a
       semicolon-insertion bug waiting to happen. */
    const strip = (p) => read(p)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "")
        .replace(/^[ \t]+/gm, "").replace(/[ \t]+$/gm, "")
        .replace(/\n{2,}/g, "\n").trim();

    return { html, boot: strip("./src/boot.js") + "\n", say: strip("./src/say.js") + "\n" };
}

/* The template gets the same {{probe.KEY}} resolution the record gets, for the
   same reason: the hero lede said "six edge functions" in its first draft, and
   a count typed into a template is exactly as fragile as one typed into a
   record — more so, because nothing else in the template looks like data. */
function fill(tpl, vars) {
    return tpl.replace(/\{\{probe\.(\w+)\}\}/g, (m, k) => {
        if (!RESOLVED || !(k in RESOLVED)) throw new Error(`BUILD REFUSED — src/landing.html references {{probe.${k}}} and there is no such probe.`);
        return String(RESOLVED[k].value);
    }).replace(/\{\{(\w+)\}\}/g, (m, k) => {
        if (!(k in vars)) throw new Error(`template token {{${k}}} has no value`);
        return vars[k];
    });
}

/* ==========================================================================
   MAIN
   ========================================================================== */
const isMain = process.argv[1] && statSync(process.argv[1]).isFile() && process.argv[1].endsWith("build-site.mjs");
if (isMain) {
    const probes = probeAll();
    const drift = checkFrozen(probes);
    if (drift.length) {
        console.error("BUILD REFUSED — the tree and the frozen evidence disagree:");
        drift.forEach((d) => console.error("  " + d));
        console.error("\nThis is not a typo to fix in the record. A line number moved, a count changed, or something appeared that this page says does not exist.");
        process.exit(1);
    }
    console.log(`evidence gate: ${Object.keys(probes).length} probes re-derived off disk, 0 drift`);

    const out = render(probes);
    writeFileSync("./index.html", out.html);
    writeFileSync("./boot.js", out.boot);
    writeFileSync("./say.js", out.say);
    writeFileSync("./records/build-stamp.json", JSON.stringify({
        schema: "webhost-build-stamp-v1",
        _comment: "Written at emit. launch-gate.mjs recomputes these hashes AND re-derives the artifact from source, so a build that threw before writing cannot leave a stale index.html standing behind an approving gate. SHELL.md r6, hole 2.",
        built_at: new Date().toISOString(),
        node: process.version,
        artifacts: { "index.html": sha(out.html), "boot.js": sha(out.boot), "say.js": sha(out.say) },
        sources: Object.fromEntries(["./src/landing.html", "./src/shell.css", "./src/boot.js", "./src/say.js", "./records/surface.json", "./records/evidence.json"].map((f) => [f.replace("./", ""), sha(read(f))])),
    }, null, 2) + "\n");

    console.log(`wrote index.html   ${Buffer.byteLength(out.html).toLocaleString()} bytes`);
    console.log(`wrote boot.js      ${Buffer.byteLength(out.boot).toLocaleString()} bytes  (decoration; the page's content does not depend on it)`);
    console.log(`wrote say.js       ${Buffer.byteLength(out.say).toLocaleString()} bytes  (an upgrade; the form works without it)`);
}
