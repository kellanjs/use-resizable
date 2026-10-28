import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Tests wrap updates in `act()`, so React shouldn't warn they're outside it.
// (Testing Library sets this itself only where Vitest's globals are on.)
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Each test starts from an empty page: Testing Library unmounts what it
// rendered, and anything a test put in the document itself is cleared.
afterEach(() => {
  if (typeof document === "undefined") return;
  cleanup();
  document.body.innerHTML = "";
});
