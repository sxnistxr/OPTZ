import { expect,test } from "bun:test";
import { safeHtml } from "../../portfolio/app/lib/safe-html";
test("Markdown output preserves prose while dropping executable HTML and URL schemes",()=>{
  const html=safeHtml('<h2 id="x">Title</h2><p><strong>hello</strong><a href="/docs/x">docs</a></p><script>alert(1)</script><img src="https://example.com/x" onerror="alert(2)"><svg><a onload="alert(3)">bad</a></svg><a href="jav&#x61;script:alert(4)">evil</a><a href="java\nscript:alert(5)">evil</a><iframe srcdoc="bad"></iframe><p>after</p>');
  expect(html).toContain('<h2 id="x">Title</h2>');expect(html).toContain('href="/docs/x"');expect(html).toContain('<p>after</p>');
  expect(html).not.toMatch(/<script|<svg|<iframe|onerror|onload|javascript:|alert\(/);
});
