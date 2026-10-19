const test = require("node:test");
const assert = require("node:assert/strict");
const katex = require("katex");

const {
  shouldRenderDollarMath,
  splitMathSegments,
} = require("../public/math-renderer.js");

test("recognizes the reported inline TeX without treating escaped currency as a delimiter", () => {
  const source = String.raw`Value of 30 mins: $55.34 \div 2 = \mathbf{\$27.67}$`;
  const segments = splitMathSegments(source);

  assert.deepEqual(segments, [
    { type: "text", value: "Value of 30 mins: " },
    {
      type: "math",
      value: String.raw`55.34 \div 2 = \mathbf{\$27.67}`,
      raw: String.raw`$55.34 \div 2 = \mathbf{\$27.67}$`,
      display: false,
    },
  ]);
  assert.match(katex.renderToString(segments[1].value, { trust: false }), /katex/);
});

test("supports text inside math and native division characters", () => {
  const source = String.raw`$115,115 ÷ 1,950 \text{ hours} = \mathbf{\$59.03 \text{ per hour}}$`;
  const [math] = splitMathSegments(source);

  assert.equal(math.type, "math");
  assert.match(katex.renderToString(math.value, { trust: false }), /59\.03/);
});

test("supports explicit inline and display delimiters", () => {
  assert.deepEqual(splitMathSegments(String.raw`Before \(x^2\) after`), [
    { type: "text", value: "Before " },
    { type: "math", value: "x^2", raw: String.raw`\(x^2\)`, display: false },
    { type: "text", value: " after" },
  ]);
  assert.equal(splitMathSegments(String.raw`\[x^2\]`)[0].display, true);
  assert.equal(splitMathSegments("$$x^2$$")[0].display, true);
});

test("keeps TeX subscripts whole and leaves math inside code spans literal", () => {
  const subscript = splitMathSegments(String.raw`Result: $x_i + y_j$`);
  assert.equal(subscript[1].value, "x_i + y_j");
  assert.match(katex.renderToString(subscript[1].value, { trust: false }), /msub/);

  const code = "Use `$x_i + y_j$` literally.";
  assert.deepEqual(splitMathSegments(code), [{ type: "text", value: code }]);
});

test("does not pair ordinary currency amounts as math", () => {
  const source = "Costs $55.34 today and $27.67 tomorrow.";
  assert.deepEqual(splitMathSegments(source), [{ type: "text", value: source }]);
  assert.equal(shouldRenderDollarMath("55.34 today and "), false);
  assert.equal(shouldRenderDollarMath(String.raw`55.34 \div 2`), true);
});

test("leaves unmatched delimiters readable", () => {
  const source = String.raw`The model returned $x + 1 without a close.`;
  assert.deepEqual(splitMathSegments(source), [{ type: "text", value: source }]);
});

test("KaTeX trust remains disabled for model-provided URL commands", () => {
  const source = String.raw`\href{javascript:alert(1)}{click}`;
  const output = katex.renderToString(source, {
    throwOnError: true,
    trust: false,
  });
  // KaTeX may preserve the rejected source in an inert MathML annotation, but
  // it must not grant the command a clickable or executable DOM element.
  assert.doesNotMatch(output, /<a\b|<script\b|<img\b/i);
  assert.doesNotMatch(output, /href\s*=/i);
});
