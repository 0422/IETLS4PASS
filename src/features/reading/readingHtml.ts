// 2026-11-19：保留阅读富文本和答题控件，过滤脚本、事件属性和题库外部资源。
const allowedTags = new Set("a b blockquote br caption code dd div dl dt em figure figcaption h1 h2 h3 h4 h5 h6 hr i img input label li mark ol option p section select small span strong sub sup table tbody td textarea th thead tr u ul".split(" "));
const excludedTags = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "template"]);
const allowedAttrs = new Set("alt aria-label class colspan data-heading data-key data-limit data-option data-paragraph data-question data-question-id data-target data-value data-word draggable for id maxlength name placeholder rowspan title type value".split(" "));

export function readingFragment(html: string, mediaUrl: (relative: string) => string | undefined): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const node of [...template.content.querySelectorAll("*")]) {
    const tag = node.localName;
    if (excludedTags.has(tag)) {
      node.remove();
      continue;
    }
    if (!allowedTags.has(tag)) {
      node.replaceWith(...node.childNodes);
      continue;
    }
    const src = node.getAttribute("src");
    for (const attr of [...node.attributes]) {
      if (!allowedAttrs.has(attr.name)) node.removeAttribute(attr.name);
    }
    for (const attr of ["id", "for"]) {
      const value = node.getAttribute(attr);
      if (value) node.setAttribute(attr, `reading-${value}`);
    }
    if (node instanceof HTMLInputElement && !["text", "radio", "checkbox"].includes(node.type)) node.type = "text";
    if (node instanceof HTMLImageElement) {
      const media = src && /^media\/[\w.-]+$/.test(src) ? mediaUrl(src) : undefined;
      if (media) node.src = media;
      else node.replaceWith(document.createTextNode(node.alt || "题图不可用"));
    }
  }
  return template.content;
}

export function questionIds(value: string | null | undefined, order: Set<string>): string[] {
  const source = value?.trim().toLowerCase() ?? "";
  const numbers = [...source.matchAll(/\d+/g)].map(([number]) => Number(number));
  if (!numbers.length) return [];
  let ids = numbers;
  if (!/^q?\d+(?:[-_–]q?\d+)+$/.test(source)) ids = numbers.slice(0, 1);
  else if (numbers.length === 2 && /[-–]/.test(source) && numbers[1] >= numbers[0] && numbers[1] - numbers[0] < 50) {
    ids = Array.from({ length: numbers[1] - numbers[0] + 1 }, (_, index) => numbers[0] + index);
  }
  return ids.map((number) => `q${number}`).filter((id) => order.has(id));
}


// 2026-11-19：由可唯一匹配的引用定位原文文字，保留题目锚点作为退路。
function searchable(text: string) {
  const positions: number[] = [];
  let normalized = "";
  for (let index = 0; index < text.length; index += 1) {
    const raw = text[index];
    const next = /\s/.test(raw) ? " " : /[‘’]/.test(raw) ? "'" : /[‐‑‒–—]/.test(raw) ? "-" : raw.toLowerCase();
    if (next === " " && normalized.endsWith(" ")) continue;
    normalized += next;
    for (let offset = 0; offset < next.length; offset += 1) positions.push(index);
  }
  return { normalized, positions };
}

function findQuote(paragraphs: HTMLElement[], explanation = "") {
  const quoted = [...explanation.matchAll(/[“「"]([^”」"]{12,360})[”」"]/g)]
    .map(([, text]) => searchable(text.split(/\.{3}|…/)[0].trim()).normalized)
    .filter((phrase) => phrase.length >= 12).sort((a, b) => b.length - a.length);
  const bodies = paragraphs.map((element) => ({ element, ...searchable(element.textContent ?? "") }));
  for (const phrase of quoted) {
    let ambiguous = false;
    const matches = bodies.flatMap(({ element, normalized, positions }) => {
      const start = normalized.indexOf(phrase);
      if (start < 0) return [];
      if (normalized.indexOf(phrase, start + 1) >= 0) ambiguous = true;
      return [{ element, start: positions[start], end: positions[start + phrase.length - 1] + 1 }];
    });
    if (!ambiguous && matches.length === 1) return matches[0];
  }
}

// 2026-11-23：听力题面复用文本偏移到 DOM 选区的转换。
export function textRange(element: HTMLElement, start: number, end: number) {
  const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  for (let node = walk.nextNode() as Text | null; node; node = walk.nextNode() as Text | null) {
    const next = offset + node.length;
    if (!started && start < next) { range.setStart(node, start - offset); started = true; }
    if (started && end <= next) { range.setEnd(node, end - offset); return range; }
    offset = next;
  }
}

export function showReadingLocation(root: HTMLElement, id: string, explanation?: string) {
  root.querySelectorAll(".is-located").forEach((element) => element.classList.remove("is-located"));
  // 2026-11-19：用 WebView 的原生高亮范围支撑跨粗体与普通文字的引用定位。
  const highlights = "highlights" in CSS && typeof Highlight === "function" ? CSS.highlights : undefined;
  highlights?.delete("reading-reference");
  const question = CSS.escape(id);
  const passage = root.querySelector(".passage-paper");
  const paragraphs = [...(passage?.querySelectorAll<HTMLElement>("p, li") ?? [])];
  const quote = explanation ? findQuote(paragraphs, explanation) : undefined;
  const paragraphId = explanation?.match(/\bparagraph\s+([A-Z])\b/i)?.[1]?.toUpperCase();
  const authored = passage?.querySelector<HTMLElement>(`[id="reading-${question}-anchor"], [data-question="${question}"]`);
  const labelled = paragraphId ? passage?.querySelector<HTMLElement>(`[data-paragraph="${paragraphId}"]`)?.closest(".paragraph-wrapper, p, li") : null;
  const field = root.querySelector<HTMLElement>(`[data-answer-ids~="${question}"]`);
  const target = quote?.element ?? (explanation ? authored ?? labelled ?? field : field ?? authored);
  if (quote && highlights) {
    const range = textRange(quote.element, quote.start, quote.end);
    if (range) highlights.set("reading-reference", new Highlight(range));
  }
  target?.classList.add("is-located");
  target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
}
