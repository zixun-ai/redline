import { expect, it } from "vitest";
import { clearOfText, type Line } from "./placement";

const body: Line[] = [[100, 116], [122, 138], [144, 160]];

it("leaves an edge that falls between lines where it is", () => {
  expect(clearOfText(body, 119, 1)).toBe(119);
  expect(clearOfText(body, 119, -1)).toBe(119);
});

it("moves an edge that cuts a line to just past it, on the composer's side", () => {
  expect(clearOfText(body, 130, 1)).toBe(139);
  expect(clearOfText(body, 130, -1)).toBe(121);
});

it("takes the boundary when the next line starts right where the cut one ends", () => {
  const meeting: Line[] = [[100, 116], [116.2, 132]];
  expect(clearOfText(meeting, 110, 1)).toBe(116);
});

it("clears every line the edge cuts at once, as with two columns side by side", () => {
  const columns: Line[] = [[100, 116], [104, 120], [124, 140]];
  expect(clearOfText(columns, 110, 1)).toBe(121);
});

it("finds a clear edge beyond the full staggered run in either direction", () => {
  const staggered: Line[] = [[100, 116], [110, 126], [120, 136], [130, 146]];
  expect(clearOfText(staggered, 112, 1)).toBe(147);
  expect(clearOfText(staggered, 134, -1)).toBe(99);
});
