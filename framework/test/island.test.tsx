import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { island } from "../src/island";

const Counter = ({ start }: { start: number }) => <button>{start}</button>;

test("islands render their HTML inside a marked wrapper with JSON props", () => {
  const I = island("components/Counter.island.tsx", Counter, "visible");
  const html = renderToString(<I start={3} />);
  expect(html).toBe('<optz-island data-id="components/Counter.island.tsx" data-props="{&quot;start&quot;:3}" data-hydrate="visible"><button>3</button></optz-island>');
});

test("an island inside an island renders inline (the outer one owns it)", () => {
  const Inner = island("Inner", Counter);
  const Outer = island("Outer", () => <div><Inner start={1} /></div>);
  const html = renderToString(<Outer />);
  expect(html.match(/<optz-island/g)).toHaveLength(1);
});
