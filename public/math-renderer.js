// Keep delimiter recognition testable in Node while the browser-facing helper
// renders with the locally hosted KaTeX build.
(function exposeMathRenderer(root, factory) {
  const helpers = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = helpers;
  } else {
    root.hypermaniaMath = helpers;
  }
}(typeof globalThis === "object" ? globalThis : this, () => {
  const IGNORED_TAGS = new Set(["CODE", "PRE", "SCRIPT", "STYLE", "TEXTAREA"]);
  const DELIMITERS = [
    { left: "$$", right: "$$", display: true },
    { left: "\\[", right: "\\]", display: true },
    { left: "\\(", right: "\\)", display: false },
    { left: "$", right: "$", display: false, currencyAware: true },
  ];

  function isEscaped(source, index) {
    let slashes = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
    return slashes % 2 === 1;
  }

  function findClosingDelimiter(source, delimiter, start) {
    let index = source.indexOf(delimiter, start);
    while (index !== -1) {
      const isSingleDollar = delimiter === "$";
      const isPartOfDisplayDollar = isSingleDollar
        && (source[index - 1] === "$" || source[index + 1] === "$");
      if (!isEscaped(source, index) && !isPartOfDisplayDollar) return index;
      index = source.indexOf(delimiter, index + delimiter.length);
    }
    return -1;
  }

  function shouldRenderDollarMath(value) {
    const candidate = value.trim();
    if (!candidate) return false;

    // A leading amount is currency unless the contents contain clear math
    // syntax. This keeps pairs such as "$55 today and $27 tomorrow" readable
    // while still accepting model output such as "$55 \\div 2 = ...$".
    const startsLikeCurrency = /^\d[\d,.]*(?:\s|$)/.test(candidate);
    const hasMathSyntax = /\\[A-Za-z]+|[=+*/^_{}]|\s[-]\s|[×÷≤≥≠]/.test(candidate);
    return !startsLikeCurrency || hasMathSyntax;
  }

  function splitMathSegments(source) {
    const segments = [];
    let textStart = 0;
    let index = 0;

    const appendText = (value) => {
      if (!value) return;
      const previous = segments.at(-1);
      if (previous?.type === "text") previous.value += value;
      else segments.push({ type: "text", value });
    };

    while (index < source.length) {
      if (source[index] === "`" && !isEscaped(source, index)) {
        const codeEnd = findClosingDelimiter(source, "`", index + 1);
        if (codeEnd !== -1) {
          index = codeEnd + 1;
          continue;
        }
      }

      const delimiter = DELIMITERS.find(({ left }) => source.startsWith(left, index) && !isEscaped(source, index));
      if (!delimiter) {
        index += 1;
        continue;
      }

      const contentStart = index + delimiter.left.length;
      const closeIndex = findClosingDelimiter(source, delimiter.right, contentStart);
      if (closeIndex === -1) {
        index += delimiter.left.length;
        continue;
      }

      const value = source.slice(contentStart, closeIndex);
      if (delimiter.currencyAware && !shouldRenderDollarMath(value)) {
        index += delimiter.left.length;
        continue;
      }

      appendText(source.slice(textStart, index));
      const end = closeIndex + delimiter.right.length;
      segments.push({
        type: "math",
        value,
        raw: source.slice(index, end),
        display: delimiter.display,
      });
      index = end;
      textStart = end;
    }

    appendText(source.slice(textStart));
    return segments;
  }

  function renderMathInElement(target, katexApi = globalThis.katex) {
    if (!target || !katexApi?.render) return;

    const renderTextNode = (textNode) => {
      const segments = splitMathSegments(textNode.nodeValue || "");
      if (!segments.some((segment) => segment.type === "math")) return;

      const fragment = textNode.ownerDocument.createDocumentFragment();
      segments.forEach((segment) => {
        if (segment.type === "text") {
          fragment.appendChild(textNode.ownerDocument.createTextNode(segment.value));
          return;
        }

        const math = textNode.ownerDocument.createElement("span");
        try {
          // Model output is untrusted. Disabling trust prevents URL, HTML, and
          // style commands from gaining capabilities beyond math typesetting.
          katexApi.render(segment.value, math, {
            displayMode: segment.display,
            throwOnError: true,
            trust: false,
            strict: "warn",
          });
          fragment.appendChild(math);
        } catch {
          // A malformed or unsupported formula should remain readable and must
          // never be reinserted as HTML.
          fragment.appendChild(textNode.ownerDocument.createTextNode(segment.raw));
        }
      });
      textNode.replaceWith(fragment);
    };

    const visit = (node) => {
      if (node.nodeType === 1 && IGNORED_TAGS.has(node.tagName)) return;
      if (node.nodeType === 3) {
        renderTextNode(node);
        return;
      }
      [...node.childNodes].forEach(visit);
    };

    visit(target);
  }

  return { renderMathInElement, shouldRenderDollarMath, splitMathSegments };
}));
