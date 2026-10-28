# @kellanjs/use-resizable

Headless React hooks for resizable UI: sidebars, drawers, images, floating
windows, split panes, IDE layouts and grids.

The hooks hand you props to spread onto your own elements. You own the markup
and every pixel of styling; the library owns sizes, limits, snapping, dragging,
keyboard control and persistence.

- React 18 or later; for its types, TypeScript 5.4 or later.
- No CSS to import and no wrapper components: every element is yours.

```sh
npm install @kellanjs/use-resizable
```

The examples style with Tailwind classes; any CSS works the same way.

<!-- toc -->

## Contents

- [Quick start](#quick-start)
- [Concepts](#concepts)
  - [Two hooks](#two-hooks)
  - [Terms](#terms)
  - [The same ideas in both hooks](#the-same-ideas-in-both-hooks)
  - [Sizes](#sizes)
  - [Stops](#stops)
- [`useResizable`, a guide](#useresizable-a-guide)
  - [Anchors and handles](#anchors-and-handles)
  - [A sidebar or a drawer](#a-sidebar-or-a-drawer)
  - [A rail: stops on a sidebar](#a-rail-stops-on-a-sidebar)
  - [Floating and confined](#floating-and-confined)
  - [Aspect ratio](#aspect-ratio)
- [`useResizableLayout`, a guide](#useresizablelayout-a-guide)
  - [A row or column](#a-row-or-column)
  - [Dragging a separator](#dragging-a-separator)
  - [The layout is data](#the-layout-is-data)
  - [Groups in groups](#groups-in-groups)
  - [Grids](#grids)
  - [Junctions](#junctions)
  - [What lights up](#what-lights-up)
  - [Separators beside a child at zero](#separators-beside-a-child-at-zero)
  - [Locking and disabling](#locking-and-disabling)
- [How a layout shares space](#how-a-layout-shares-space)
  - [1. Empty space: one child takes what's left](#1-empty-space-one-child-takes-whats-left)
  - [2. Shrinking: who gives way](#2-shrinking-who-gives-way)
  - [3. Growing: who takes extra space](#3-growing-who-takes-extra-space)
  - [4. Stepping down to fit](#4-stepping-down-to-fit)
  - [5. Overflow and `refuseOverflow`](#5-overflow-and-refuseoverflow)
  - [6. What a call protects, and what a drag keeps](#6-what-a-call-protects-and-what-a-drag-keeps)
  - [7. `%` limits in nested groups](#7--limits-in-nested-groups)
  - [Questions](#questions)
- [Content while it resizes](#content-while-it-resizes)
  - [Cover and slide](#cover-and-slide)
  - [Deciding what to show](#deciding-what-to-show)
  - [Crossfading a rail](#crossfading-a-rail)
  - [The content size](#the-content-size)
  - [Divider lines](#divider-lines)
  - [Reflowing once](#reflowing-once)
- [Persistence](#persistence)
  - [What caused a change](#what-caused-a-change)
  - [One layout per document](#one-layout-per-document)
  - [Across tabs](#across-tabs)
  - [Other storage](#other-storage)
  - [Changes made from callbacks](#changes-made-from-callbacks)
  - [Server rendering without a flash](#server-rendering-without-a-flash)
- [Motion](#motion)
- [Styling](#styling)
- [Accessibility](#accessibility)
- [Performance](#performance)
- [Recipes](#recipes)
  - [Sidebar with an icon rail](#sidebar-with-an-icon-rail)
  - [IDE layout](#ide-layout)
  - [App shell that closes panes in order](#app-shell-that-closes-panes-in-order)
  - [Grid dashboard](#grid-dashboard)
  - [Bottom drawer](#bottom-drawer)
  - [Floating window](#floating-window)
  - [Image in a document](#image-in-a-document)
  - [Workspace of panes](#workspace-of-panes)
  - [Double-click to reset](#double-click-to-reset)
  - [Driven by code](#driven-by-code)
  - [Keeping what stepped down](#keeping-what-stepped-down)
- [Building blocks](#building-blocks)
- [Reference](#reference)
  - [`useResizable` options](#useresizable-options)
  - [Dimension options](#dimension-options)
  - [Stop options](#stop-options)
  - [`useResizableLayout` options](#useresizablelayout-options)
  - [Group options](#group-options)
  - [Child options](#child-options)
  - [Grid options](#grid-options)
  - [Options both hooks share](#options-both-hooks-share)
  - [What `useResizable` returns](#what-useresizable-returns)
  - [What `useResizableLayout` returns](#what-useresizablelayout-returns)
  - [Props](#props)
  - [CSS variables](#css-variables)
  - [Remotes](#remotes)
  - [Types](#types)
  - [Without React](#without-react)
  - [Exports](#exports)
- [Pitfalls](#pitfalls)

<!-- /toc -->

## Quick start

### One element: a sidebar

`useResizable` resizes one element whose size is its own. Spread
`getElementProps()` onto the element and `getHandleProps(edge)` onto each handle
you drag:

```tsx
import { useResizable } from "@kellanjs/use-resizable";

export function AppFrame() {
  const sidebar = useResizable({
    anchor: "start", // the left edge stays still (the right, right to left)
    width: {
      defaultSize: "16rem",
      minSize: "12rem",
      maxSize: ["28rem", "50%"], // 28rem, or half the container if smaller
    },
    persist: { key: "sidebar" }, // saved to localStorage
  });

  return (
    <div className="flex h-screen">
      <aside {...sidebar.getElementProps()} className="relative border-e">
        <nav className="p-4">Navigation</nav>
        <div
          {...sidebar.getHandleProps("end")}
          aria-label="Resize sidebar"
          className="absolute inset-y-0 -end-1 w-2 hover:bg-blue-500/40"
        />
      </aside>
      <main className="min-w-0 flex-1 p-4">Main content</main>
    </div>
  );
}
```

The handle is an ordinary element you place and style; the library makes it
draggable, focusable (arrow keys resize) and announced as a separator. The main
area beside the sidebar is plain flexbox: it takes what the sidebar leaves.

### Elements sharing space: a split

`useResizableLayout` resizes elements that share one space, so one grows by
taking from its neighbours. Describe the layout as data, then spread props onto
a group's element, its children and the separators between them:

```tsx
import { useResizableLayout } from "@kellanjs/use-resizable";

export function Editor() {
  const editor = useResizableLayout({
    layout: {
      id: "editor",
      direction: "row",
      children: [
        { id: "files", defaultSize: 240, minSize: 160 },
        { id: "code", minSize: 320 }, // no defaultSize: takes the rest
        { id: "preview", defaultSize: "30%", minSize: 200 },
      ],
    },
    persist: { key: "editor" },
  });

  return (
    <div {...editor.getGroupProps("editor")} className="h-screen">
      <nav {...editor.getElementProps("files")}>Files</nav>
      <div
        {...editor.getSeparatorProps("files", "code")}
        aria-label="Resize files"
        className="w-px bg-neutral-300"
      />
      <main {...editor.getElementProps("code")}>Code</main>
      <div
        {...editor.getSeparatorProps("code", "preview", { primary: "after" })}
        aria-label="Resize preview"
        className="w-px bg-neutral-300"
      />
      <section {...editor.getElementProps("preview")}>Preview</section>
    </div>
  );
}
```

Here the layout is a single group, its root (`id: "editor"`); a layout with
groups inside it calls `getGroupProps` once per group (see
[Groups in groups](#groups-in-groups)).

A separator's size is the room it takes, so a 1px line is a 1px target; [A
separator](#a-separator) gives it a wider hit area that takes no room.
`primary: "after"` makes the second separator about the preview (its value, its
keys, its label), as it's the preview that a user resizes there.

From here, the guides build on these two:
[`useResizable`](#useresizable-a-guide) and
[`useResizableLayout`](#useresizablelayout-a-guide). [How a layout shares
space](#how-a-layout-shares-space) has every rule for complex layouts, and
[Reference](#reference) every option with its type and default.

## Concepts

### Two hooks

| Hook                 | Use it for                                                                               | You drag                                              |
| -------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `useResizable`       | One element whose size is its own: a sidebar, a drawer, an image, a chat widget.         | handles, which drive its free edges and corners       |
| `useResizableLayout` | Elements sharing one space, in rows and columns: an editor split, an IDE layout, a grid. | separators, which sit between the children of a group |

The difference is where the space comes from. A resizable sidebar grows into
whatever is next to it, and the page reflows. An element in a layout grows by
taking space from its neighbours, so the layout resolves them together: if one
hits its minimum, the next gives way; if one snaps to a smaller stop, the other
side takes the space.

### Terms

- An **element** is something resized that you put content in, in either hook: a
  sidebar, or one pane of a layout.
- A **handle** is any element you drag to change a resizable: an edge handle, a
  corner handle, or a floating element's move handle. It's your own element,
  placed and styled as you like.
- A handle's **edge** is the part of the element it drives (`"right"`, or a
  corner like `"top-left"`, which drives two edges), not where the handle sits.
- A **layout** is what one `useResizableLayout` coordinates: elements in
  **groups**, each group a row or a column of **children**. A child is an
  element, another group, or a grid; the layout's root is the top group (or a
  grid). Every group, grid and element has an `id`.
- A **grid** lays its children out in columns and rows at once: its columns and
  rows are **tracks** that resize like a group's children, and its children are
  **cells** placed on them, spanning one or more.
- A **separator** sits between two neighbouring children of a group (or two
  neighbouring tracks of a grid). Dragged like a handle, whatever one side
  gains, the other loses. It's your own element: the library connects it to its
  two neighbours, not to a place on screen.
- A **line** is the boundary between two neighbours that a drag moves. Usually
  one separator draws it; a grid line that a spanning cell cuts is drawn by
  several, its **segments**, which move and light up together.
- A **junction** drags several separators at once, the way a corner handle
  drives two edges. You render it where they cross.
- A **stop** is a named size (a **point**, like a rail) or range of sizes (a
  **range**, like open) that a dimension or a layout child rests in. A dimension
  or a child with its stops is a **track**, and so is a grid's column or row.
- **Stepping down** is a layout child moving to a smaller stop on its own,
  because its group's minimums don't fit, and back up once they do (`yieldTo`).
- A **fill** is a layout element that takes whatever space its siblings leave,
  instead of having a size of its own (`fill`).
- **Zero** is the library's word for a size of 0 (`hideAtZero`, `data-zero`), so
  it can't be confused with your stop names, like `closed`.
- The **content size** is the size an element's content is laid out at, which
  can differ from the element's own while it resizes (`contentSize`; see
  [Content while it resizes](#content-while-it-resizes)).

### The same ideas in both hooks

The two hooks name the same ideas the same way where they can:

| Idea                         | `useResizable`                         | `useResizableLayout`                       |
| ---------------------------- | -------------------------------------- | ------------------------------------------ |
| What's resized               | `getElementProps()`                    | `getElementProps(id)`, `getGroupProps(id)` |
| Its content (optional)       | `getContentProps()`                    | `getContentProps(id)`                      |
| A layer clipping it          | `getClipProps()`                       | `getClipProps(id)`                         |
| What it sits in              | its container (`containerRef`)         | the root group, `getGroupProps(rootId)`    |
| What you drag                | `getHandleProps(edge)`                 | `getSeparatorProps(before, after)`         |
| Two at once                  | a corner, `getHandleProps("top-left")` | `getJunctionProps([[a, b], [c, d]])`       |
| Live state                   | `width`, `height`                      | `getChild(id)`, `elements`                 |
| Its stop, and the one before | `width.stop`, `width.previousStop`     | `getChild(id).stop`, `.previousStop`       |
| Where this change began      | `width.fromStop`                       | `getChild(id).fromStop`                    |
| Content to show for the stop | `width.contentStop`                    | `getChild(id).contentStop`                 |
| Stepped down to fit, from    | —                                      | `getChild(id).yieldedFrom`                 |
| Move to a stop               | `setStop("rail")`                      | `setStop(id, "rail")`                      |
| Back to the defaults         | `reset()`, `reset("width")`            | `reset()`, `reset(id)`                     |
| Being dragged                | `dragging`: an edge, or `"move"`       | `dragging`: `[{ before, after }]`          |
| Transitioning                | `animating`, `data-animating`          | `animating`, `data-animating`              |
| At zero                      | `data-zero`                            | `data-zero`                                |
| Reached from elsewhere       | `createResizableRemote()`              | `createLayoutRemote()`                     |

### Sizes

Anywhere a size (or a floating element's position) is accepted, it can be:

| Value     | Meaning                                                                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `240`     | Pixels.                                                                                                                                         |
| `"240px"` | Pixels.                                                                                                                                         |
| `"16rem"` | Root ems. Follows the root font size, even if it changes.                                                                                       |
| `"25%"`   | For `useResizable`, a percentage of the container, along the same dimension. In a layout, a percentage of the space the group's children share. |
| `"25vw"`  | A percentage of the viewport's width (`vh`: its height), as in CSS. Follows the window as it resizes.                                           |

Sizes can't be negative (a floating element's position can). The type is
`SizeValue`.

**Lists of limits.** `minSize` and `maxSize` (and a range's `min` and `max`)
also take a list, and every entry applies, so the tightest wins:
`maxSize: ["28rem", "50%"]` means "28rem, or half the container if that's
smaller", like CSS `min(28rem, 50%)`. The type is `SizeBound`.

**When limits conflict.** When a minimum and maximum disagree
(`minSize: "17.5rem"` with `maxSize: "90%"` in a narrow container), the minimum
wins, as in CSS: the element's content stays usable, and it can be wider than
what it sits in. `wins: "max"` lets the maximum win instead, so what's beside it
stays usable:

```ts
width: { minSize: "17.5rem", maxSize: ["32.5rem", "90%"], wins: "max" }
```

`wins` is per dimension (or layout child, or grid track) and covers all its
ranges. It applies to limits from outside it too: the container's room with
`confine`, an aspect ratio's, and what a nested group's children need.

**Whole boxes.** A size is the element's whole box, padding and border included.
For `useResizable`, `getElementProps` sets `box-sizing: border-box` on what it
sizes (your `style` can say otherwise, but its stops and its room in a container
then leave the padding and border out). A layout's sizes are whole boxes
whatever `box-sizing` its children use: it allows for `content-box` itself.

**Kept as given.** A size you give (a default, or `setSize`) is kept as you gave
it until the user resizes: a `%` width stays a percentage, so it follows the
container as the window resizes. A drag or a key sets it in pixels. (A layout's
children keep their share of the group's space either way.)

In a layout, a child's sizes are along its group's direction: its width in a
row, its height in a column. How `%` limits behave in nested groups is in [`%`
limits in nested groups](#7--limits-in-nested-groups).

### Stops

Without `stops`, a dimension or layout child is one range, from `minSize` to
`maxSize`. With `stops`, it's a set of named places it can be: single sizes
(points), or ranges of sizes.

```ts
width: {
  defaultSize: "16rem",
  stops: {
    closed: { size: 0, onlyByName: true },
    rail: "3.5rem",
    open: { min: "12rem", max: ["28rem", "50%"] },
  },
}
```

| Stop  | Written as                                                         |
| ----- | ------------------------------------------------------------------ |
| point | a size, `"3.5rem"`, or `{ size: "3.5rem" }` with options beside it |
| range | `{ min, max }`; `min` defaults to 0, `max` to unbounded            |

The names are yours: there's no built-in "collapsed" or "expanded". `width.stop`
(or a layout child's `stop`) names the stop it's in, typed from your options,
and `data-width-stop` / `data-stop` expose it to CSS. Whether `rail` means
"collapsed", "compact" or something else is your app's call. Without named
stops, `stop` is `null`. `stops` and `minSize`/`maxSize` can't be combined: give
the range in `stops` its own `min` and `max`.

Each stop takes options (`pull`, `onlyByName`, `endsDrag`, `elastic`), listed in
[Stop options](#stop-options) and explained below.

#### Where a size lands

Drags, arrow keys and `setSize` all ask for a size, and the stops decide where
it lands:

1. **Inside a stop**, it stays as asked: in a range, the size follows the
   pointer.
2. **In a gap between stops**, it goes to the nearer side, dividing the gap
   halfway. `pull` (default 1) moves the dividing point: with
   `rail: { size: "3.5rem", pull: 3 }`, the rail claims three quarters of each
   gap beside it, so leaving it takes a longer drag.
3. **Beyond every stop**, it stops at the nearest one (with an elastic stretch
   past a range's end while dragging).
4. **`onlyByName: true`** stops are never landed on by a drag, the arrow keys or
   `setSize`. Only naming them reaches them (`setStop`, `toggle`, or Enter when
   `enterToggles` names one), for states a button should reach but a drag
   shouldn't, like closed.
5. **`endsDrag: true`** stops end the drag when it lands in them (or passes
   through them, however fast the pointer moves), as if the pointer had been
   released: the move into the stop animates, and the rest of the gesture is
   ignored until the next press. For gestures that should play out on their own,
   like a drawer closing: `closed: { size: 0, endsDrag: true }`. A range with it
   goes to the size it has there, as `setStop` would, rather than where the
   pointer was (just past its edge), so a drawer pulled open (`endsDrag` on its
   open range) opens as a toggle would. Dragging out of the stop works as usual.

**Elastic stretch.** While dragging, a size can stretch a little past a stop's
edge, with resistance, and spring back on release. By default ranges stretch at
their ends and points stay crisp. A stop's own `elastic` option changes _where_
that happens: `true` or `false` for both ways, or `"larger"` / `"smaller"` for
one. With `rail: { size: "3.5rem", elastic: "larger" }` the rail gives a little
when pulled open, but not when pushed smaller (where, if the only stop below is
an `onlyByName` one, nothing would happen); `elastic: false` on a range makes
its ends hard. A stretch is resistance: it happens where the pointer has gone
past a stop's edge (a rail pulled open, a maximum pushed, a minimum pushed on
the way back). Where a drag snaps across a gap to a stop the pointer hasn't
reached yet, the pointer is short of it, and it sits at that stop's edge
(opening from a rail lands at exactly the minimum).

> [!NOTE]
> Two options are called `elastic`. A **stop's** `elastic` says where a stretch
> happens (which ways, at that stop). The **hook's** `elastic` option says how a
> stretch feels (how far and how stiff, and `afterSnap`), or turns stretching
> off entirely; see [Motion](#motion).

**Order and overlaps.** The order stops are written in doesn't matter. They're
resolved and sorted by size after measuring, which matters when some are `%` and
some `rem`: their order can change with the window. Stops may overlap. While the
size is inside the current stop, it stays in that stop; otherwise it's in the
narrowest stop containing it. So a point inside a range (say `half: "50%"`
inside `open`) is passed over by drags and reached with `setStop("half")`.

#### Moving between stops

- `setStop("rail")` goes to a point, or to a range at the size it last had
  there. Each range remembers its own size.
- `toggle("rail")` goes to `rail`, or if it's already there, back: to the stop
  it came from if that's a larger one, so hiding a sidebar from its rail and
  showing it again comes back to the rail; otherwise to the last range it was
  in. (Where it came from is where it last rested, not a stop a drag passed
  through.)
- In `useResizable`, without a dimension, both act on every dimension with a
  stop of that name, so a width and a height that share one (say `minimised`)
  move together. A toggle then decides once: back only if both are at the stop,
  otherwise both go to it. Pass a dimension to act on just one, as in
  `toggle("minimised", "height")`.
- Enter on a focused handle or separator toggles a stop too: by default the
  smallest stop a drag can reach (when there's more than one), or the one
  `enterToggles` names (`false` for none). See [Accessibility](#accessibility).
- `defaultStop: "rail"` starts there. Without it, a track starts wherever
  `defaultSize` lands (a layout child without either starts in its roomiest
  stop). Give named stops a `defaultStop` for exact server HTML: until it knows
  which stop `defaultSize` lands in, the CSS before measuring is just
  `defaultSize`.
- `defaultSize` is optional when there's a `defaultStop`. A range the track
  hasn't been in then starts at its minimum, and toggling back with no range to
  return to goes to the roomiest stop.
- `setStop` with a name that isn't one of the stops throws (and is a type
  error).

## `useResizable`, a guide

Every option is in [`useResizable` options](#useresizable-options), with its
type and default; what the hook returns is in [What `useResizable`
returns](#what-useresizable-returns).

### Anchors and handles

The anchor says which part of the element stays still while it resizes, named
like CSS `background-position`. It decides which handles there are. With both
`width` and `height`:

| Anchor           | Stays still                       | Handles                                        |
| ---------------- | --------------------------------- | ---------------------------------------------- |
| `"left"`         | the left edge, centred vertically | `right`, `top`, `bottom`, both right corners   |
| `"top"`          | the top edge, centred across      | `left`, `right`, `bottom`, both bottom corners |
| `"top-left"`     | the top-left corner               | `right`, `bottom`, `bottom-right`              |
| `"bottom-right"` | the bottom-right corner           | `left`, `top`, `top-left`                      |
| `"center"`       | the centre                        | all four edges and corners                     |
| `"none"`         | nothing: the element is floating  | all eight, plus a move handle                  |

The other sides and corners (`"right"`, `"bottom"`, `"top-right"`,
`"bottom-left"`) work the same way.

- **Only dimensions you configure are resizable.** A sidebar (`anchor: "left"`)
  with only `width` gets only its `right` handle, and a drawer
  (`anchor: "bottom"`) with only `height`, only `top`.
- **`handles` offers fewer** than the anchor allows: corners only on an image,
  say (then a corner takes the keyboard; see [Accessibility](#accessibility)),
  or `handles: []` for an element only your code resizes.
- **Reading direction.** The sides can go by reading direction, as layouts do:
  `"start"` and `"end"`, and corners like `"top-start"` and `"bottom-end"`.
  They're the left and right in a left-to-right page, and the other way round in
  a right-to-left one, by the element's CSS `direction`. A sidebar with
  `anchor: "start"` stays at the start either way. The `handles` option and
  `getHandleProps` take the same names (`getHandleProps("end")`), while the
  returned `handles` list, and `data-handle`, give the physical edges, so styles
  written for `left` and `right` keep working.
- **When the direction is read.** When the element mounts, each time its
  container is measured, and when a handle is pressed. Before it mounts, it's
  left to right, as on the server, which can't know: so a right-to-left page
  hydrates the server's HTML as it is, and the handles move to their side as it
  mounts, before anything's painted.

> [!IMPORTANT]
> The anchor describes your CSS layout; it doesn't create it. A centred image
> needs CSS that centres it _and_ `anchor: "top"` or `"center"`, so the library
> knows each pixel of drag should grow both sides (twice the size change).
> Centre it with flex or grid (`align-self: center` in a column) rather than
> `margin: auto`: pulled past its max, the element is briefly wider than its
> container, and auto margins then align it left, so the stretch shows only on
> the right.

**Handles.** A handle is any element you spread `getHandleProps(edge)` onto,
where `edge` is the part of the element it drives (an edge, or a corner), not
where it sits. Usually it sits on that edge, inside the element, but it can be
anywhere: a drag moves the edge by however far the pointer moves. You place it,
size it and style it. The usual placement is centred on its edge or corner,
absolutely positioned in the element (which then needs `position: relative`, or
any other positioning), with a bigger hit area on a touch screen. Render one per
entry of `handles` to offer them all:

```tsx
import { type HandleEdge, useResizable } from "@kellanjs/use-resizable";

const PLACEMENT: Record<HandleEdge, string> = {
  left: "inset-y-0 left-0 w-2 pointer-coarse:w-6 -translate-x-1/2",
  right: "inset-y-0 right-0 w-2 pointer-coarse:w-6 translate-x-1/2",
  top: "inset-x-0 top-0 h-2 pointer-coarse:h-6 -translate-y-1/2",
  bottom: "inset-x-0 bottom-0 h-2 pointer-coarse:h-6 translate-y-1/2",
  "top-left": "top-0 left-0 z-10 size-3 pointer-coarse:size-8 -translate-1/2",
  "top-right":
    "top-0 right-0 z-10 size-3 pointer-coarse:size-8 translate-x-1/2 -translate-y-1/2",
  "bottom-left":
    "bottom-0 left-0 z-10 size-3 pointer-coarse:size-8 -translate-x-1/2 translate-y-1/2",
  "bottom-right":
    "bottom-0 right-0 z-10 size-3 pointer-coarse:size-8 translate-1/2",
};

export function Box() {
  const box = useResizable({
    anchor: "top-left",
    width: { defaultSize: 320, minSize: 160 },
    height: { defaultSize: 200, minSize: 120 },
  });

  return (
    <div {...box.getElementProps()} className="relative border">
      Content
      {box.handles.map((edge) => (
        <div
          key={edge}
          {...box.getHandleProps(edge)}
          aria-label={`Resize box (${edge})`}
          className={`absolute ${PLACEMENT[edge]} hover:bg-blue-500/40`}
        />
      ))}
    </div>
  );
}
```

- Corners go above edges (`z-10`), so where they overlap, the corner wins.
- `pointer-coarse:` (or `@media (pointer: coarse)`) gives fingers a bigger
  target, from the first render.
- When the element goes to zero against its container's edge, a handle centred
  on that edge is half cut off if the container clips. The handle has
  `data-zero` then, so it can move to the open side (see [Bottom
  drawer](#bottom-drawer)). It's set as a change to zero begins, so move it with
  the change's timing (`--resizable-duration`, `--resizable-easing`), or it
  jumps out before the element closes.
- Don't put `overflow: hidden` on the element: it would clip handles that hang
  over its edge. Clip an inner wrapper instead (see [Pitfalls](#pitfalls)).
- [A handle](#a-handle) in Building blocks is the same placement as plain CSS.

### A sidebar or a drawer

The [quick start](#one-element-a-sidebar) is a complete sidebar. The parts that
matter:

- **The container.** `%` sizes are of the element's container: its parent,
  unless `containerRef` points elsewhere. The main area beside it is yours
  (flexbox, say); the library only sizes the sidebar.
- **Limits.** `minSize` and `maxSize` make one range. With [stops](#stops)
  instead, the sidebar can rest at a rail, or close.
- **Your code.** `sidebar.setSize({ width: "20rem" })` lands like a drag would
  (inside the range, or at the nearest stop), and before the container is
  measured it waits for it. `sidebar.reset()` goes back to the defaults;
  `reset("width")`, just the width.
- **Its state.** `sidebar.width` has the `size` in pixels (`null` until
  measured), the `stop` it's in, the `stops` in pixels, and the content fields
  ([Content while it resizes](#content-while-it-resizes)). The type knows which
  dimensions you configured, so `sidebar.width.size` needs no `?.`. To size
  something to a stop before anything is measured (a rail's icon column), share
  the CSS length with the options instead.

A drawer is the same thing turned round: `anchor: "bottom"` with only `height`,
so its handle is `top`. Stops like
`{ closed: 0, open: { min: 96, max: "80%" } }` let it close; [Bottom
drawer](#bottom-drawer) is the complete recipe, including where its handle goes
at zero.

### A rail: stops on a sidebar

A rail is a stop: a point the sidebar rests at, between closed and open.

```ts
width: {
  defaultSize: "16rem",
  defaultStop: "open",
  stops: {
    closed: { size: 0, onlyByName: true }, // a button closes it; a drag can't
    rail: { size: "3.5rem", endsDrag: true },
    open: { min: "12rem", max: ["28rem", "50%"] },
  },
}
```

Dragging narrower than the open range snaps to the rail at the gap's halfway
point; `endsDrag` makes reaching the rail end the drag, as if released, so the
collapse plays out on its own instead of following the pointer. `toggle("rail")`
and `toggle("closed")` are the buttons. Show the rail's content by
`width.contentStop`, not `width.stop` (which changes as a change begins, so the
open content would vanish as the closing starts): see [Deciding what to
show](#deciding-what-to-show). [Sidebar with an icon
rail](#sidebar-with-an-icon-rail) is the complete recipe.

**A stop, or a range's minimum?** Make the rail a stop when it's a state of its
own: sizes between it and the open range aren't places to rest (a drag there
snaps to one or the other), `stop` and `contentStop` name it, and the open
content keeps its open size while the rail shows. When the narrowest size is
just small rather than different (a pane that can be dragged as narrow as you
like, down to its minimum), leave it the open range's minimum, and to show
something there, compare `contentSize` with the minimum (see [Deciding what to
show](#deciding-what-to-show)).

### Floating and confined

With `anchor: "none"` the element is floating: it has a position as well as a
size, and a move handle.

- **Its position** is `x`, `y` from the container's top-left, inside its border,
  and may be negative. Like an absolutely positioned element's, its position and
  `%` sizes are of the container's padding box. It starts at `defaultPosition`
  (default `{ x: 0, y: 0 }`), and `setPosition({ x, y })` moves it.
- **Its styles.** It gets `position: absolute`, `left` and `top`, so its
  container needs a positioning of its own (`position: relative`).
- **The move handle** is `getMoveHandleProps()`, spread onto a title bar, say.
  It takes arrow keys too: give it a label that says so.
- **Resizing** from an edge or corner keeps the opposite side still.

`confine: "container"` keeps it inside its container:

- It's never bigger than the container, unless its minimum is: as in CSS, the
  minimum wins, unless `wins: "max"` (see [Sizes](#sizes)).
- It's shown inside the container whatever moved it: a drag, the keyboard,
  `setSize`, `setPosition`, or the container shrinking. A width or height you
  size yourself (with CSS, or its content) counts as drawn: the element is
  measured for it.
- Resized from an edge, it can't reach a stop whose smallest size is bigger than
  the room on that side (a point, or a range's minimum): a drag (or a key; Enter
  by default goes no further than the room either) stops on one that fits,
  rather than show the stop at a size it isn't, or past the edge. `setStop`
  still goes there, moving the element inside, and so does Enter to the stop
  `enterToggles` names.
- An elastic stretch gives at the element's own limits, but not at the
  container's edge.
- The position you set is kept, so it goes back there when there's room again:
  resizing it doesn't change it, unless the resize moved it (from the left or
  top) or it was shown somewhere else to fit (then it stays where it was seen).

`defaultPosition` and `confine` need `anchor: "none"` (anything else throws).
[Floating window](#floating-window) is the complete recipe.

### Aspect ratio

`aspectRatio: 16 / 9` (width ÷ height) locks the ratio. Only the width is
stored, and CSS `aspect-ratio` sizes the height:

- Height handles still work: they drive the width through the ratio.
- `height` takes only `minSize` and `maxSize`, which become width limits through
  the ratio.
- `setSize({ height })` sizes the width through the ratio, in pixels (a height
  in `vh` doesn't stay relative as a width); given both, the width is used.
- The height's stops are the width's: `setStop(stop, "height")` goes to the
  width's stop.

A corner can only move along its path (the line from the anchor out through the
corner), and `cornerDrag` says how it follows the pointer:

- `"nearest"` (the default): it goes to the point on that path nearest the
  pointer. This feels smooth in every direction, but off the path the corner
  trails the pointer.
- `"axis"`: it stays on the pointer along whichever axis you pull further (pulls
  in opposite directions offset each other). Use it when people line an edge up
  with something exactly, as in design tools. The cost is unevenness: near the
  start of a drag, wobble one way is ignored and the other way counts.

[Image in a document](#image-in-a-document) is the complete recipe.

## `useResizableLayout`, a guide

Every option is in [`useResizableLayout` options](#useresizablelayout-options)
and the tables after it (groups, children, grids, tracks, cells), with their
types and defaults; what the hook returns is in [What `useResizableLayout`
returns](#what-useresizablelayout-returns). The rules for how children share
space are in [How a layout shares space](#how-a-layout-shares-space).

### A row or column

```tsx
import { useResizableLayout } from "@kellanjs/use-resizable";
import { Fragment } from "react";

export function Editor() {
  const editor = useResizableLayout({
    layout: {
      id: "editor",
      direction: "row",
      children: [
        {
          id: "files",
          defaultSize: 240,
          defaultStop: "open",
          stops: { closed: 0, open: { min: 180 } },
        },
        { id: "code", minSize: 320 },
        { id: "preview", defaultSize: "30%", minSize: 200 },
      ],
    },
  });

  return (
    <div {...editor.getGroupProps("editor")} className="h-full">
      {editor.elements.map((element, index) => (
        <Fragment key={element.id}>
          {index > 0 && (
            <div
              {...editor.getSeparatorProps(
                editor.elements[index - 1].id,
                element.id,
              )}
              // About the child before it (see Accessibility).
              aria-label={`Resize ${editor.elements[index - 1].id}`}
              className="relative w-px bg-neutral-700"
            >
              {/* A wider area to grab, 4px past the line on each side. */}
              <span className="absolute -inset-x-1 inset-y-0" />
            </div>
          )}
          <section {...editor.getElementProps(element.id)}>
            {element.id}
          </section>
        </Fragment>
      ))}
    </div>
  );
}
```

**The layout.** `layout` is the root group: its `id`, its `direction` (`"row"`
lays children out left to right; `"column"`, top to bottom), its `children`, and
optionally `refuseOverflow` (see [Overflow](#5-overflow-and-refuseoverflow)).
Nested groups take the same. Every id must be unique in the layout, and not
empty.

**Sizes are along the group's direction.** A child's `defaultSize`, `minSize`,
`maxSize` and stops are its width in a row and its height in a column. Across
the group, every child is as big as the group (flexbox stretches it). So in a
column inside a row, `minSize` is a height; the column's own `minSize`, as a
child of the row, is a width.

**Children without a `defaultSize`** share whatever space is left. One child
must be able to take the space the others leave: see [rule
1](#1-empty-space-one-child-takes-whats-left).

**Separators, gaps and padding.** Separators can be any size, and gaps, padding
and borders are fine, on groups and on children: the layout measures what its
children actually got, and each child's own padding and border are part of its
size. One limit comes from CSS: nothing renders smaller than its own padding and
border, so a child that goes to zero (or to a rail narrower than its padding)
should pad an inner wrapper instead. (Its siblings are drawn smaller by that
much, and their content laid out so.)

**Right to left.** In a right-to-left page (`direction: rtl`, or `dir="rtl"` on
any ancestor), a row lays its children out from the right, and drags and arrow
keys follow the screen: moving a separator right grows the child on its right,
whichever it is in the options. Each row's direction is read from the page when
a drag or key press starts.

**A separator's hit area.** A separator sits in the layout between two children,
so flexbox places it. Being in the layout, its size is the room it takes: a 1px
line is a 1px target. To make it easier to grab without taking more room, give
it a wider child, as above (it overlaps its neighbours' edges, so it goes above
them: the separator `relative`, and a `z-index` on the wider child if they're
positioned; see [Junctions](#junctions) for why not on the separator). Each
separator has `data-direction` (its group's), so one component can draw both
kinds: `data-[direction=row]:w-px data-[direction=column]:h-px`. [A
separator](#a-separator) in Building blocks does all of this in plain CSS.

**Live state.** Both hooks re-render with the live sizes during a drag (see
[Performance](#performance)). `editor.getChild("files")` has its `size`, `stop`,
`stops` and content fields; `editor.elements` lists every element in reading
order. To follow every change without re-rendering (or outside React), subscribe
to the controller: `editor.controller.subscribe(listener)`.

### Dragging a separator

A drag (or an arrow key on a focused separator) moves the line between two
neighbours: whatever one side gains, the other loses.

1. **Within their stops**, the neighbours follow the pointer.
2. **A neighbour at the end of its stop, with another stop beyond it**, stops
   there and snaps across the gap once the pointer passes the gap's dividing
   point (see [Where a size lands](#where-a-size-lands)), but only if the other
   side can take or give exactly that much.
3. **A neighbour with nothing beyond it** lets the drag push on to the next
   child, and the next (cascading). With `cascade: false`, the separator stops
   there instead.
4. **A neighbour snapping across a gap goes first.** Opening a strip next to a
   pane just above its minimum: the strip opens once the pointer passes its own
   dividing point, the pane gives what it has down to its minimum, and the
   children beyond give the rest. From there the drag carries on as if it had
   started that way: the pane stops at its minimum, and collapses only when the
   pointer passes its dividing point in turn.
5. **Drags don't use `priority`, `grow` or stepping down**: a drag moves the
   children beside it. (How children beside a fill move is in [Fills](#fills).)

A drag never pushes a child below its minimum, and a separator that can't change
anything either way is disabled for the moment (see [What lights
up](#what-lights-up)).

### The layout is data

`layout` is the source of truth, so a "dynamic" layout is just one that changes:

- **Adding** a child: it gets its `defaultSize` (or a fair share) and the others
  make room, growing from 0 as they do; those that keep their size (`keepSize`)
  only once nothing else can. One coming back gets the size it had, the same
  way. If several join at once and don't all fit, they share what's short in
  proportion to their sizes.
- **Removing** a child: the others take its space, at once. Its size is
  remembered, so it comes back the size it was.
- **Reordering**: sizes travel with the children.

Keep ids stable. They identify children across renders, reorders and saved
layouts. [Workspace of panes](#workspace-of-panes) is the complete recipe.

### Groups in groups

A child with its own `direction` and `children` is a group:

```tsx
import { useResizableLayout } from "@kellanjs/use-resizable";

export function Ide() {
  const ide = useResizableLayout({
    layout: {
      id: "ide",
      direction: "row",
      children: [
        { id: "files", defaultSize: 220, minSize: 160 },
        {
          id: "work",
          direction: "column",
          children: [
            { id: "editor", minSize: 200 }, // a height: work is a column
            {
              id: "terminal",
              defaultSize: 160,
              stops: { bar: "2rem", open: { min: 80 } },
            },
          ],
        },
      ],
    },
  });

  return (
    <div {...ide.getGroupProps("ide")} className="h-screen">
      <nav {...ide.getElementProps("files")}>Files</nav>
      <div
        {...ide.getSeparatorProps("files", "work")}
        aria-label="Resize files"
        className="w-px bg-neutral-300"
      />
      <div {...ide.getGroupProps("work")}>
        <main {...ide.getElementProps("editor")}>Editor</main>
        <div
          {...ide.getSeparatorProps("editor", "terminal", { primary: "after" })}
          aria-label="Resize terminal"
          className="h-px bg-neutral-300"
        />
        <section {...ide.getElementProps("terminal")}>Terminal</section>
      </div>
    </div>
  );
}
```

This is one layout, not two groups that don't know about each other. A nested
group is sized like any child of its parent (it takes the same size options:
`defaultSize`, stops, `keepSize`, `yieldTo`…), and it can't shrink below what
its own children need. Ids are typed from the options, nested ones included, and
so is each child's stops: a typo in `getElementProps("edtor")` or
`setStop("terminal", "closd")` is a type error. The callbacks get the same ids
(`onDragStart`'s separators, `valueText`'s `id`).

**Rendering a tree.** Written out like this, the markup mirrors the tree. When
the tree is data (the user can split and merge panes), render it recursively
with `childrenOf(id)`, which lists a group's children, each
`{ id, kind, previous }`:

- `kind` is `"element"`, `"group"` or `"grid"`;
- `previous` is the child before it (`null` for the first), and the separator
  between them is `getSeparatorProps(previous, id)`.

```tsx
import { type ResizableLayout } from "@kellanjs/use-resizable";
import { Fragment, type ReactNode } from "react";

export function renderGroup(workspace: ResizableLayout, id: string): ReactNode {
  return (
    <div {...workspace.getGroupProps(id)}>
      {workspace.childrenOf(id).map((child) => (
        <Fragment key={child.id}>
          {child.previous && (
            <div
              {...workspace.getSeparatorProps(child.previous, child.id)}
              aria-label={`Resize ${child.previous}`}
            />
          )}
          {child.kind === "element" ? (
            <section {...workspace.getElementProps(child.id)}>
              {child.id}
            </section>
          ) : (
            renderGroup(workspace, child.id)
          )}
        </Fragment>
      ))}
    </div>
  );
}
```

Start it with the root's id. A grid's `childrenOf` lists its cells (each with
`previous: null`), and its lines come from `separatorsOf`: see [Grids](#grids).
Keep the props' `id`: it's the element's DOM id, which separators point at
(`aria-controls`). To pass your own id to a component, use another name, like
`paneId`.

### Grids

A grid lays its children out in columns and rows at once. (In a tree, the two
columns of a 2×2 layout each have their own row line; in a grid, a line runs
through the whole grid.) Its columns and rows are **tracks**, each sized like a
group's child, and its children are **cells** placed on them with `column` and
`row` (track ids), spanning `columnSpan` columns and `rowSpan` rows (1 each by
default):

```tsx
import { useResizableLayout } from "@kellanjs/use-resizable";

const CELLS = ["chart", "stats", "table", "log"] as const;

export function Dashboard() {
  const dashboard = useResizableLayout({
    layout: {
      id: "dashboard",
      columns: [
        { id: "left", minSize: 160 },
        { id: "middle", minSize: 160 },
        {
          id: "right",
          defaultSize: 260,
          stops: { closed: 0, open: { min: 200 } },
        },
      ],
      rows: [{ id: "top" }, { id: "bottom" }],
      children: [
        { id: "chart", column: "left", columnSpan: 2, row: "top" },
        { id: "stats", column: "right", row: "top", rowSpan: 2 },
        { id: "table", column: "left", row: "bottom" },
        { id: "log", column: "middle", row: "bottom" },
      ],
    },
  });

  return (
    <div {...dashboard.getGroupProps("dashboard")} className="h-screen">
      {CELLS.map((id) => (
        <section key={id} {...dashboard.getElementProps(id)}>
          {id}
        </section>
      ))}
      {dashboard
        .separatorsOf("dashboard")
        .map(({ key, before, after, segment }) => (
          <div
            key={key}
            {...dashboard.getSeparatorProps(before, after, { segment })}
            aria-label={`Resize ${before}`}
            className="separator"
          />
        ))}
      {/* Where the line between middle and right crosses the row line. */}
      <div
        {...dashboard.getJunctionProps([
          ["middle", "right"],
          ["top", "bottom"],
        ])}
        className="junction"
      />
    </div>
  );
}
```

- **Tracks** take a child's size options (`defaultSize`, `minSize`, `maxSize`,
  `stops`, `defaultStop`, `enterToggles`, `wins`, `keepSize`, `priority`,
  `grow`, `yieldTo`, `locked`, `fill`), along the grid's width for a column and
  its height for a row. A track is named by its id, like any child:
  `setStop("right", "closed")`, `getChild("right")` (its size, stop, stops and
  content size), keys, snapshots.
- **Cells** have no size of their own (each is as big as the tracks it spans),
  so they take no size options, and `getChild` is for their tracks. A cell takes
  `getElementProps`, `getContentProps`, `getClipProps` and `hideAtZero` (hidden
  while it rests at 0 either way). Cells can't overlap, and a span can't run
  past the last track (both throw).
- **A cell's content size** is its tracks' together: while any track it spans is
  in a range, what they show, so a cell spanning a track that closes reflows
  with its edge, as a child resized within its stop does; only while all of them
  close or open (or rest at points) is its content kept at theirs.
- **Lines.** A line runs between two neighbouring tracks, named like a
  separator, `["left", "middle"]`, wherever no cell spans across it: above, the
  line between left and middle runs under the chart only. A cell spanning across
  a line in the middle cuts it in two. Each stretch is a **segment**, an element
  of its own: `separatorsOf(id)` lists them, each
  `{ key, before, after, segment }` (for a group, its separators, all
  `segment: 0`), and `getSeparatorProps(before, after, { segment })` places one.
  Grab any segment and the whole line moves; its segments light up together.
- **It's a CSS grid** (`display: grid`, its templates set by the library), with
  a track between each two of its tracks for the line there, as thick as the
  line's segments: a line takes room, as a separator does in a group. Cells,
  segments and junctions are placed for you, so their order in the markup
  doesn't matter, but for the tab order.
- **Junctions.** A junction of one of its column lines and one of its row lines
  places itself on their crossing (positioned absolutely in the grid, which is
  `position: relative`), at no cost through drags and animations: give it a
  size, and it's centred there. Other junctions you place yourself (see
  [Junctions](#junctions)).
- **Cells clip.** Cells get `contain: size` and `overflow: hidden`: they're as
  big as their tracks whatever's in them (content larger than a cell spanning
  tracks would otherwise widen the lines between them).
- **Where a grid goes.** A grid can be the layout's root, or a child of a group,
  sized in it like any child (with the same size options), and a change in its
  size passes to its tracks.
- **A cell can be a group or a grid itself**: give it `direction` and
  `children`, or `columns`, `rows` and `children`, as a group's child would, and
  render it with `getGroupProps(id)`. A change in its tracks' sizes passes to
  it, and a track can't be smaller than a cell of its own needs (its group's
  children, or its grid's tracks, that way). Across a cell spanning several
  tracks, that's not kept to: the tracks together could need to be bigger, which
  the library doesn't work out, so its content is clipped instead.
- **Gaps.** A grid's gaps changing resize nothing the layout watches: it notices
  a change of the grid's own `class` or `style`, but one from an ancestor or a
  CSS variable shows at the grid's next resize.

[Grid dashboard](#grid-dashboard) is the complete recipe, styled.

### Junctions

Where separators cross, a **junction** drags them together, the way a corner
handle drives two edges. Like a corner, it's an element you render and place:
name the separators it drags (each `[before, after]`, as for
`getSeparatorProps`), and put it where they cross. A separator only ever drags
itself; nothing is inferred from where things sit on screen.

```tsx
<div
  {...ide.getSeparatorProps("editor", "terminal", { primary: "after" })}
  aria-label="Resize terminal"
  className="relative h-px"
>
  {/* The left end of this line, where the files separator crosses it. */}
  <div
    {...ide.getJunctionProps([
      ["files", "work"],
      ["editor", "terminal"],
    ])}
    className="absolute top-1/2 left-0 z-30 size-3 -translate-1/2"
  />
</div>
```

- **Where it goes in the DOM** is up to you. Inside one of its separators, like
  a corner inside its element, it moves with that line for free, through drags
  and animations alike: the separator is the one element already where the lines
  meet. Elsewhere, you place it yourself (from the children's sizes, which jump
  where the transition glides, or with CSS anchor positioning). In a grid, it
  places itself (see [Grids](#grids)).
- It gets the `move` cursor when its separators run different ways, and
  `data-dragging` while it's dragged (its separators get theirs too).
- While a mouse or pen is over it, it and the separators it would drag get
  `data-hover` (see [What lights up](#what-lights-up)).
- Pointer-only, like a corner (`aria-hidden`, out of the tab order): each
  separator it drags is reachable from the keyboard on its own.
- Pressing it doesn't also start a drag of the separator it's inside.
- **Mind stacking:** it has to be above the hit areas of the separators it
  crosses. A separator with a `z-index` is a stacking context of its own, so a
  junction's `z-index` inside it only counts within it; put the `z-index` on the
  hit areas and junctions instead. In development, when a separator gets a press
  inside a junction's box (so something covers the junction there), the library
  warns.
- Separators that move the same space can't be dragged together: two in one
  group, or in nested groups that run the same way (moving the outer one resizes
  the inner group). Only the first named moves, and in development it warns.
- Which separators meet where is yours to say, and can change. In two columns
  each divided in two, say, render one junction for the column line and both
  middle lines while the middle lines line up (compare their sizes), and one per
  middle line otherwise.

[A junction](#a-junction) in Building blocks has its CSS.

### What lights up

`:hover` only applies to the element under the pointer, but a press can move
more than that: a junction drags several separators, and in a grid each line can
be several segments that move as one. So while a mouse or pen is over a
separator or junction, every separator a press there would drag gets
`data-hover`, and so does the junction itself: it's what `data-dragging` will be
once the pointer moves. Style those two instead of `:hover`, and the lines that
light up are the lines that will move:

```tsx
<div
  {...editor.getSeparatorProps("files", "code")}
  aria-label="Resize files"
  className="bg-white/10 data-[dragging]:bg-cyan-400 data-[hover]:bg-cyan-400/60"
/>
```

A touch has no hover, so nothing is left lit after a tap.

A separator that can't change anything right now, either way (one with only
fixed sizes on one side and nothing beyond them to give, say, or beside a
`"last"` fill with no space) doesn't pretend to: no resize cursor, no
`data-hover`, and a press does nothing. Unless Enter can still take its child to
a stop (one only reachable by name, say), it's also `aria-disabled` (still
focusable, so focus doesn't jump around). Style `[aria-disabled]` to dim or hide
it; it comes back once it can. One that can push a child at its minimum along,
or collapse one, counts as able to move. A separator you disable (see [Locking
and disabling](#locking-and-disabling)) gets the same treatment, as does one
beside a locked child with nothing beyond it.

### Separators beside a child at zero

A child at zero takes no room, but its separators stay: they sit where it was,
against the group's edge or against another separator, and dragging one opens
the child again. Whether that's wanted is yours to decide: keep them grabbable,
or hide them.

**`data-zero`** on a separator says which neighbour is at zero: `"before"`,
`"after"` or `"both"`. Like an element's, it's about the size the layout is
going to (below half a pixel), so it's set as a change to zero begins and
cleared as one out of it begins, not when the line arrives: styles on it move
with the change, not after it. With `"both"`, neither side has room to open
into; the separator may still move (pushing children beyond, with cascading), so
it isn't disabled (`aria-disabled` says when nothing can move), and where its
hit area goes is your choice.

**Keeping them grabbable.** Two lines in one place are two of your elements
overlapping, and the one on top gets the press. The [separator's
CSS](#a-separator) moves the hit area wholly onto the open side next to a child
at zero, above its neighbours, so a separator against the group's edge or
another line can still be pressed.

**Two that lie together.** Below, the preview is the last child of `work`, and
the outline comes after `work`. With both closed, the preview's line (at the end
of `work`) and the outline's (at the end of the row) are both at the right edge,
and both hit areas move onto the same side. Which lines meet there is your
layout's to know, as with junctions; the separators' `data-zero` says when. Step
one of them aside with `--separator-offset`, and give them labels (and, if you
like, visible grips) that say which is which, since they're in the same place:

```tsx
import { useResizableLayout } from "@kellanjs/use-resizable";

const closable = { closed: 0, open: { min: 200 } };

export function Workbench() {
  const ide = useResizableLayout({
    layout: {
      id: "ide",
      direction: "row",
      children: [
        {
          id: "work",
          direction: "row",
          children: [
            { id: "editor" },
            { id: "preview", defaultSize: 300, stops: closable },
          ],
        },
        { id: "outline", defaultSize: 240, stops: closable },
      ],
    },
  });
  const preview = ide.getSeparatorProps("editor", "preview", {
    primary: "after",
  });
  const outline = ide.getSeparatorProps("work", "outline", {
    primary: "after",
  });
  // Both closed: the preview's line lies on the outline's.
  const stacked = !!preview["data-zero"] && !!outline["data-zero"];

  return (
    <div {...ide.getGroupProps("ide")} className="h-screen">
      <div {...ide.getGroupProps("work")}>
        <main {...ide.getElementProps("editor")}>Editor</main>
        <div
          {...preview}
          aria-label="Resize preview"
          className="separator"
          data-stacked={stacked ? "" : undefined}
        />
        <section {...ide.getElementProps("preview")}>Preview</section>
      </div>
      <div {...outline} aria-label="Resize outline" className="separator" />
      <aside {...ide.getElementProps("outline")}>Outline</aside>
    </div>
  );
}
```

```css
/* A stacked separator takes the strip beyond its neighbour's, toward its
   open side. Lines that lie together are often a line's thickness apart
   (one at the end of a nested group, one just after it), so two reaches
   leave no gap between the strips. */
.separator[data-stacked][data-zero="after"] {
  --separator-offset: calc(-2 * var(--separator-reach));
}
.separator[data-stacked][data-zero="before"] {
  --separator-offset: calc(2 * var(--separator-reach));
}
```

Pressing just inside the edge then opens the outline, and a little further in,
the preview; the highlight follows the offset, so hovering or focusing each
shows where it is. They stay two tab stops, each labelled for its own child:
they do different things. The library doesn't work out which lines lie together
itself: that's a fact about where your layout puts things, nested groups and
all, and how to present it is yours.

**Hiding them.** To make a closed child reopen only through your own controls,
hide the separators beside it:

```css
.separator[data-zero] {
  visibility: hidden;
}
```

`visibility: hidden` keeps the line's room and takes it out of the tab order and
the accessibility tree; not rendering it (or `display: none`) also gives up its
room, which nudges the layout by the line's thickness. Either way, it hides as
the closing begins (that's when `data-zero` is set). If the separator had focus,
move focus to whatever reopens the child. And hiding one separator doesn't stop
the child opening through its other one, a junction, or the keyboard on a
neighbour: `disabledSeparators` and `locked` (below) are the tools for that.

### Locking and disabling

To keep the user from resizing one child, lock it; to keep them from moving one
separator, disable it; to turn off every drag and key, disable the layout. All
three are options, so they can follow your app's state (a "lock layout" toggle,
say):

```ts
useResizableLayout({
  layout: {
    id: "editor",
    direction: "row",
    children: [
      { id: "files", defaultSize: 240, locked: filesLocked },
      { id: "code" },
      { id: "preview", defaultSize: "30%" },
    ],
  },
  disabledSeparators: previewLocked ? [["code", "preview"]] : [],
  disabled: layoutLocked,
});
```

- **`locked: true`** on a child keeps its size through drags and keys. A drag
  that reaches it pushes on past it to the children beyond (with `cascade`), so
  a separator beside it moves only if there's something beyond to give or take;
  with nothing, it's disabled. Your calls for its siblings (`setStop`,
  `setSize`) take room from it only if nothing else can give it, and a `"last"`
  fill takes space before it grows. Calls for it still move it, and when the
  window resizes, it keeps its share like any other child (add `keepSize` to
  keep its size then too).
- **`disabledSeparators`** (each `[before, after]`, as for `getSeparatorProps`):
  those separators don't move under a press or a key, and a junction drags only
  its others. Their neighbours can still change other ways: another separator's
  drag pushing on into them, the window, your code.
- **`disabled: true`** on the layout: no separator or junction takes a press or
  a key. Separators are `aria-disabled`, out of the tab order, and without a
  resize cursor or `data-hover`. Your calls (`setStop`, `setSize`, `reset`, …)
  still work, and so does fitting to the window. `useResizable` takes `disabled`
  too, with the same meaning for its handles and move handle.

## How a layout shares space

The sizes in a layout are worked out together, in one of two ways:

- **A drag or an arrow key** moves one line, and only the children it pushes
  change (see [Dragging a separator](#dragging-a-separator)).
- **A fit** shares out a group's space among its children. It happens when the
  space changes (the window or the container resizing, or an outer separator
  resizing a nested group), when a call sizes a child (`setStop`, `toggle`,
  `setStops`, `setSize`, `reset(id)`), when children are added or removed, and
  when the options change.

The rules below are for fits. Each fit starts from what's saved for each child,
the stop chosen for it and its size in each range (what the user or your code
last set), not from the sizes the last fit showed. So nothing is lent or owed:
narrow the window and widen it again, and everything comes back where it was.

The rules, in short:

1. [**Empty space.**](#1-empty-space-one-child-takes-whats-left) A group's
   children always fill it, so one of them must be able to take whatever the
   others leave; calls that would leave none are refused.
2. [**Shrinking.**](#2-shrinking-who-gives-way) When a group has less room, its
   children give way in an order (fills, then children by `priority`, then those
   that keep their size, then the one being sized), each down to its minimum.
3. [**Growing.**](#3-growing-who-takes-extra-space) Extra room goes in
   proportion to size, or by `grow`; children that keep their size take it last.
4. [**Stepping down.**](#4-stepping-down-to-fit) Once the minimums don't fit,
   children with `yieldTo` step down to smaller stops, one at a time in a set
   order, across nested groups as if they were one; `keepSize: "yield-first"`
   children keep their size until no one else can step down.
5. [**Overflow.**](#5-overflow-and-refuseoverflow) If that still isn't enough,
   the children are drawn smaller than their minimums, in proportion;
   `refuseOverflow` makes calls refuse to get there.
6. [**Protection.**](#6-what-a-call-protects-and-what-a-drag-keeps) The child a
   call last changed steps down last, until the room around it shrinks; a child
   stepped down when a drag starts stays down after it.
7. [**`%` limits in nested groups**](#7--limits-in-nested-groups) are shares of
   the nested group's own space.

To find the option for a behaviour:

| You want                                                                     | Use                                                                          |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A child that keeps its size when the window resizes, the others absorbing it | `keepSize: true`                                                             |
| A child that gives way before its siblings when room is short                | a lower `priority` than theirs                                               |
| A child that takes the extra room when the window widens                     | `grow: 1` on it (and none on the others), or `fill: "first"`                 |
| Children that close, or go to a rail, when the window gets too narrow        | `yieldTo`, with a smaller stop to step down to                               |
| A child that keeps its size until the others have stepped down               | `keepSize: "yield-first"`                                                    |
| Children that may all sit at points, with spare room left empty              | a `fill: "last"` element                                                     |
| Children kept centred                                                        | a `fill` element either side                                                 |
| Buttons that can't squeeze children below their minimums                     | `refuseOverflow: true` on the group                                          |
| A child the user can't resize, or a separator they can't move                | `locked: true`, `disabledSeparators` (see [Locking](#locking-and-disabling)) |

[App shell that closes panes in order](#app-shell-that-closes-panes-in-order)
uses most of these together, with a table of what it shows at each width.

### 1. Empty space: one child takes what's left

A group's children always fill it, so one of them has to take whatever the
others leave: a child in a range with no maximum. (A maximum of `100%` or more
doesn't count: a child's `%` is of its group's space, so it can never reach it.
One in pixels does, even if it's wider than the space now: the space can grow
past it.) The library keeps one:

- `setStop`, `toggle`, `setStops` or `setSize` that would leave none (shrinking
  the last open pane to a strip, say) does nothing, with a warning in
  development. Drags and keys can't get there either. To disable a control that
  would be refused, ask first: `canSetStop(id, stop)`, `canToggle(id, stop)` and
  `canSetStops(stops)` say whether the call would change anything.

  ```tsx
  <button
    onClick={() => workspace.toggle(pane.id, "strip")}
    disabled={!workspace.canToggle(pane.id, "strip")}
  >
    {pane.title}
  </button>
  ```

- When something else leaves none (children removed, new options, a restored
  layout, defaults that start them all at points), the last child that has such
  a range goes there, at the size it last had.
- Stepping down never takes a group's last such child out of its range (see
  [rule 4](#4-stepping-down-to-fit)).

If every child has a maximum and none fills, a wide enough group still can't be
filled; for now the browser then stretches them past their maximums.

#### Fills

An element marked `fill` takes that role instead, so the others can all sit at
points. A fill has no size options (giving it any is a type error, and throws
from plain JavaScript): it starts at 0, gives its space up before any of its
siblings when they need room, and takes extra space at one of two times:

- **`fill: "last"`**: only what its siblings can't take, once they're all at
  points (or maximums). Until then the group behaves as if it weren't there; a
  sibling that opens takes the space back. A sibling with `keepSize` (or
  `locked`) doesn't count: the fill takes space before it grows.
- **`fill: "first"`**: before its siblings, which keep their sizes. A sibling
  shrinking, or the window widening, grows the fill rather than its siblings.

```tsx
import { useResizableLayout } from "@kellanjs/use-resizable";

const PANES = ["notes", "outline", "preview"] as const;
const STOPS = { strip: "2.5rem", open: { min: 220 } } as const;

export function Strips() {
  const workspace = useResizableLayout({
    layout: {
      id: "workspace",
      direction: "row",
      children: [
        ...PANES.map((id) => ({ id, defaultStop: "open", stops: STOPS })),
        { id: "spare", fill: "last" },
      ],
    },
  });

  return (
    <div {...workspace.getGroupProps("workspace")} className="h-screen">
      {PANES.map((id) => (
        <section key={id} {...workspace.getElementProps(id)}>
          <button onClick={() => workspace.toggle(id, "strip")}>{id}</button>
        </section>
      ))}
      {/* Its size is how much space is spare: put anything in it, or nothing. */}
      <div {...workspace.getElementProps("spare")} />
    </div>
  );
}
```

A fill goes wherever it is in `children`: after the others, before them, or
between. Fills of a kind share their space equally, always, so one either side
centres the others and keeps them centred.

**Dragging beside a fill.** A fill's own edges move fills together: dragging the
far edge of the pane beside one moves both outer edges, mirrored (the pane
changes twice as fast as the pointer, which stays on the edge), and a separator
between two fills is pinned. Other drags leave them be. With a separator beside
a fill, that's the neighbour's far edge:

- Next to a `"first"` fill it moves freely, the fill taking or giving the
  difference.
- Next to a `"last"` fill, which can't keep space anything else could use, it
  can open the neighbour (while the fill has space) or collapse it, but not
  resize it: dragged into the neighbour, it resists with an elastic pull, and
  the neighbour lands in its next stop down after the same pull as from the edge
  of its stop (half the gap between the two, or as `pull` divides it), however
  wide it is. The space goes to the fill if nothing else can take it.

Fills can't step down (`yieldTo`), take `priority` or `grow`, or be locked:
those are size options.

### 2. Shrinking: who gives way

When a group's space shrinks (the window narrowing, a sidebar beside it opening)
or a child needs room (a call opening or growing it, or it joining the layout),
its children give way in this order, within the group:

1. **Fills**, in proportion to their sizes.
2. **Children that don't keep their size**, in proportion to their sizes, each
   down to its minimum.
3. **Children that keep their size** (`keepSize: true`, and `"yield-first"` ones
   once they've given way: see [rule 4](#4-stepping-down-to-fit)), in equal
   amounts, each down to its minimum. For a call, a `locked` child counts as one
   of these; when the window resizes, it shares like any other child.
4. **The children the change is sizing** (the child a call is for, or children
   joining the layout), last of all, in proportion to the sizes they asked for.

Within steps 2 to 4, `priority` (a number, default 0) orders them: lower
priorities give way first, each priority down to its minimums before the next
gives any. `keepSize` is about fits: the user can still resize the child by
dragging (`locked` stops that).

```ts
children: [
  { id: "outline", defaultSize: 240, minSize: 160, priority: -1 },
  { id: "editor", minSize: 320 },
  { id: "preview", defaultSize: "30%", minSize: 200 },
],
```

Narrowing the window takes space from the outline, down to 160, before the
editor and preview give any. Widening it again brings them all back where they
were. Priorities order only the children of one group; for stepping down, they
also order children across nested groups (see [rule
4](#4-stepping-down-to-fit)).

**Shrinking comes before stepping down.** A child steps down only once its
group's minimums don't fit, so every child that can shrink shrinks to its
minimum first, `keepSize: true` ones included. The exception is
`keepSize: "yield-first"`: such a child keeps its size until stepping down can't
free any more room (see [rule 4](#4-stepping-down-to-fit)). So a `priority`
alone can't make a pane close before others shrink; `"yield-first"` on the
others can.

### 3. Growing: who takes extra space

Extra space (the window widening, a sibling shrinking or closing) goes, within
the group:

1. To **`fill: "first"`** children, equally.
2. To **children that don't keep their size**, in proportion to their sizes, so
   they keep their shares; or once any child in the group has a `grow`, to
   those, in proportion to their `grow`s (equal `grow`s, equal shares of the
   extra, not equal sizes).
3. To children that don't keep their size and still have room, equally. With
   `grow`s, this is where a child without one (or with 0) takes extra, once
   those with one are at their maximums.
4. To **`fill: "last"`** children, equally.
5. To **children that keep their size**, equally.
6. To the children the change is sizing.

Each up to its maximum. Extra space isn't shared by priority.

```ts
children: [
  { id: "outline", defaultSize: 240, minSize: 160 },
  { id: "editor", minSize: 320, grow: 1 }, // takes the extra
  { id: "preview", defaultSize: "30%", minSize: 200 },
],
```

`grow` is about extra space beyond the sizes the user set: narrowing the window
again takes it back in proportion to size (give the child a lower `priority` to
have it give way first). To keep a child from growing at all while its siblings
can, `keepSize` says so directly. Grid tracks take `priority` and `grow` too.

### 4. Stepping down to fit

Rather than be squeezed, a child can step down to a smaller stop when the
minimums don't fit, and back up as soon as there's room. `yieldTo` names, for
each stop it may leave, the stop it may go to:

```ts
{
  id: "inspector",
  stops: {
    closed: { size: 0, onlyByName: true },
    compact: 56,
    open: { min: 240 },
  },
  yieldTo: { open: "compact", compact: "closed" },
}
```

Each name must be one of its stops, and the steps can't come back round. Naming
a stop reached only by name (`onlyByName`) lets the child step down there.

**When.** A group steps its children down while what they need doesn't fit the
space they share: their minimums, with each `keepSize: "yield-first"` child that
hasn't given way counted at its size. So shrinking comes first ([rule
2](#2-shrinking-who-gives-way)), and stepping down only once every child that
can shrink is at its minimum.

**Across nested groups.** The children of the groups inside step down too, as if
they were in one row with their group's siblings. The layout decides from the
outermost group in: a group that's short steps down its own children and those
of every group inside it, in one order, and a nested group starts from what the
groups around it decided. So a page two groups down closes before a sidebar
beside them is squeezed below its minimum, and a pane in one group keeps its
size, if it's `"yield-first"`, until a pane in another group (inside the same
short group) has stepped down. A layout steps down the same whether its panes
are grouped or not, but for one thing: each group keeps a child taking its space
([rule 1](#1-empty-space-one-child-takes-whats-left)), so a pane alone in a
group, or beside only fixed sizes there, stays where flat it would close.

**The order.** One step at a time, the first step in this order that frees space
is taken, and the fit tries again:

1. **By tier**: first children that don't keep their size; then those that do
   (`keepSize: true` or `"yield-first"`) or are `locked`; last, the [protected
   child](#6-what-a-call-protects-and-what-a-drag-keeps) (and any group it's
   in).
2. **Within a tier, lower `priority` first.** Priorities are compared across the
   whole short group, nested groups included: a pane with `priority: -1` two
   groups down steps down before a pane with `priority: 0` beside them.
3. **Of equal priority, the last child first**, in the order of the whole layout
   as written (depth first: a group's children come right after it).
4. **A child takes all its steps before the next takes any** (open to compact to
   closed, say), as long as each frees space.
5. **A step is taken only if it frees space**, and never one that would leave
   its group with nothing to take the space.
6. **Where a group's size across is the largest of its children's** (a column of
   rows inside a row, say), the widest rows step down together, or none does: a
   step that frees nothing isn't taken.
7. **`keepSize: "yield-first"` children** don't count in the steps above while
   anything else can step down, but for the protected child, which waits for
   them too: it's last of all. Once nothing else can, the first of them in this
   same order gives way: it shrinks, down to its minimum, and then may step down
   itself; then the next, one at a time.
8. **Back up**: on every fit, the stepping down is worked out again from the
   stops chosen, so a child steps back up as soon as its group fits with it at
   its chosen stop: the last to step down is the first back up.

Only options, the protected child and the children a drag keeps down ([rule
6](#6-what-a-call-protects-and-what-a-drag-keeps)) decide the order, so it's the
same on every fit: a child that has just been added isn't spared.

**`keepSize: "yield-first"`** is what makes a pane keep its size while others
close. With plain `keepSize: true`, a child keeps its size when the window
resizes, but it still shrinks to its minimum (rule 2) before anything steps
down. With `"yield-first"`, it keeps its size until no child that can step down
(anywhere in the short group, nested groups included, but for the protected
child) can free any more room;
only then does it give way, down to its minimum, before it steps down itself.
Several give way one at a time, in the order above. For a sidebar that keeps its
width while panes beside it close:

```ts
{ id: "sidebar", defaultSize: 300, keepSize: "yield-first", priority: 1,
  stops: { closed: 0, open: { min: 180 } } },
{ id: "page", keepSize: true, priority: -1,
  stops: { closed: 0, open: { min: 280 } }, yieldTo: { open: "closed" } },
```

**What's shown and what's saved.** Stepping down isn't a change you made, and
nothing about it is saved: `stop` is where the child is, and `yieldedFrom` the
stop chosen for it (`null` when it hasn't stepped down), which is what's saved
and what it goes back to when there's room. `onChange` isn't called for it.
`previousStop` and `fromStop` see it like any change of stop, so crossfades and
sliding content follow it. A change of space (the window resizing) steps down at
once; a call's stepping down animates with the call.

**Calls choose.** `setStop(id, "compact")` on a child that stepped down to
`compact` keeps it there with room too, and `setStop(id, "open")` shows it open,
the others stepping down instead if they can (`canSetStop` says it would change
something). A call that asks for a child that then has to step down anyway still
chooses: it's shown stepped down, and opens when there's room. With
`refuseOverflow`, such a call (or `reset(id)`) is refused instead.

**Groups and tracks step down too.** A nested group is a child like any other:
give it its own `yieldTo` for it to step down as a whole. A grid's tracks take
`yieldTo` too, and a cell's group or grid steps down with the tracks it's on.
Fills can't take `yieldTo`.

To have a child that stepped down stay there until it's opened again, rather
than come back with room, see [Keeping what stepped
down](#keeping-what-stepped-down).

### 5. Overflow and `refuseOverflow`

When the children's minimums add up to more than the group's space, even after
stepping down (a narrow window, or opening a child into a full group), they
share it in proportion to their sizes, below their minimums (a grid's tracks
too), and `overflowing` is `true`; groups inside them get their share. Each
keeps its own padding and border; the rest of the space goes in proportion to
the rest of their sizes. A child's `size` stays the size it's given (its stop,
what's saved, the separator's `aria-valuenow`); `contentSize` is the size it's
drawn at, which its content is laid out at. Show a hint, send something to zero,
or have the group refuse calls that would get it there.

A group that shouldn't be squeezed by your calls says `refuseOverflow: true` (on
a grid, for its columns and rows):

```ts
layout: {
  id: "workspace",
  direction: "row",
  refuseOverflow: true,
  children: panes,
},
```

Then a `setStop`, `toggle`, `setStops`, `setSize` or `reset(id)` that would
leave its children further past its space than they are does nothing, and
`canSetStop`, `canToggle` and `canSetStops` say so beforehand, so a button can
be disabled, or the app can say there's no room. So does a call that would show
the child it asks for stepped down. A call that makes it no worse goes ahead, so
an overfull layout can always be fixed (closing a pane, say). It's about calls:
children added to `children` are never refused (the layout is data), and the
window narrowing still squeezes them. Drags and keys can't push a child below
its minimum anyway.

### 6. What a call protects, and what a drag keeps

**A call's child steps down last.** The child a call last changed (`setStop`,
`toggle`, `setSize`, `reset(id)`; with `setStops`, the last child it moved) is
the **protected child**: it gives way last of all ([rule
2](#2-shrinking-who-gives-way)), and it steps down last, after every other
child, `keepSize` ones included ([rule 4](#4-stepping-down-to-fit)), so what you
just opened isn't taken back while anything else can make room. A call that
changes nothing doesn't count. Only one child is protected at a time, and a
group it's in counts as protected with it.

It stays protected until:

- **a group it's in gets less room from elsewhere** (the window narrowing, an
  outer separator dragged against it);
- **the options change** (a re-render with the same options doesn't count); or
- **another call changes something** (or a `reset()` of everything, or a
  `restore`).

Then the options' order decides again. More room doesn't end it, so widening the
window never closes what the call opened (to let something the call had closed
come back).

**A call doesn't change the sizes that are kept.** Room a call takes from
children that keep their size (`keepSize`, or `locked`) is only lent: they show
smaller while there isn't room, keep their sizes saved, and come back to them as
room returns, as after the window narrows. So does the call's own child, if it
keeps its size: opened into less room than its size, it shows what fits and
saves its size. Other children's sizes are shares of their group's space, which
a call changes, as adding a child does. A drag or a key press is the user's
choice: what it shows is saved.

In the [app shell](#app-shell-that-closes-panes-in-order) at 700px wide, say,
the panel has stepped down to closed. A button calling
`setStop("panel", "open")` opens it at its minimum, 260: the diagram gives way
to its minimum, and the sidebar, keeping its size first, gives the rest (300 to
200, with its 300 still saved). Widening the window to 900 keeps the panel open,
at 340, and the sidebar is back at 300. Narrowing it to 700 again ends the
protection, and the panel, now in its usual place in the order, closes again. It's the same across groups: at 1100,
`setStop("page", "open")` opens the page, the diagram giving way to its minimum
and the panel, keeping its size first, the rest (340 to 280), though the page is
in another group.

**A drag keeps what it showed.** A drag doesn't step the children of the groups
it drags down or up as it goes; the release does, animating. (In the groups
inside those children, whose space the drag changes, children step down and back
up as the space does.) But a child already stepped down when a drag (or a key
press) starts stays down after it, even where the move made room for it: the
room went to what was dragged, and the release keeps what the drag showed. It
steps back up at the next change from elsewhere: its group's space changing (by
a pixel or more), new options, or a call (`setStop`, a reset, a restore). A key
that moves the child itself lets it go too. That's not saved either. As for
sizes, a drag saves what each child in the groups it resizes showed, those
inside its children included.

### 7. `%` limits in nested groups

A child's `%` sizes are shares of its group's space. A nested group's children's
`%` limits are shares of the nested group's own space, so they don't make it
bigger:

- A child needing `"90%"` of it fits whatever its size, with only its padding
  needed.
- Beside a sibling needing 50px, it needs 500px (the 50px are the 10% left).
- Minimums adding up to more than 100% can't all be met; exactly 100% fits, with
  no room left for anything else.
- Maximums of `%`s alone that add up to less than 100% don't limit it: they stop
  at their shares, and the rest of it is left empty, as in CSS.
- A maximum of `100%` or more never stops a child, so it doesn't stop it taking
  the space ([rule 1](#1-empty-space-one-child-takes-whats-left)).

### Questions

- **Does a pane keep its size until a pane in another group steps down?** If
  it's `keepSize: "yield-first"` and both are inside the group that's short of
  room (usually the root, when the window narrows): yes. Stepping down treats
  the short group and every group inside it as one list ([rule
  4](#4-stepping-down-to-fit)).
- **Two `"yield-first"` panes at different depths: which gives way first?** The
  first in stepping-down order: lower `priority` first, then the one later in
  the layout. Depth doesn't matter. Each gives way fully (down to its minimum,
  then any steps of its own) before the next.
- **Is `priority` enough to make one pane close before another shrinks?** No:
  every pane shrinks to its minimum before any steps down. Give the panes that
  should keep their size `keepSize: "yield-first"`, and use `priority` to order
  the closing ([rule 2](#2-shrinking-who-gives-way)).
- **Which way is `minSize` in a nested group?** Along that group's direction: a
  height in a column, a width in a row. The nested group's own `minSize` is
  along its parent's direction.
- **Why didn't a pane come back when I widened the window after a drag?** It was
  stepped down when the drag started, so it stays down until a change from
  elsewhere ([rule 6](#6-what-a-call-protects-and-what-a-drag-keeps)): its own
  group's space changing by a pixel or more, new options, or a call. Widening
  the window counts only if it changes that group's space.
- **Why doesn't widening the window close what my button opened?** The button's
  child is protected, and more room never ends that ([rule
  6](#6-what-a-call-protects-and-what-a-drag-keeps)).
- **My button squeezed a pane: is its size lost?** Not if it keeps its size
  (`keepSize`): it shows smaller while there isn't room, and comes back to its
  size as room returns ([rule 6](#6-what-a-call-protects-and-what-a-drag-keeps)).

## Content while it resizes

While its element resizes, content can behave four ways:

- **Squeeze** (the default): laid out at the element's size, it reflows (and
  rewraps) as the element changes. Nothing to add.
- **Cover**: laid out at its open size, it stays put while the moving edge
  covers and uncovers it.
- **Slide**: laid out at its open size, it travels with the moving edge as the
  element closes to 0 or opens from it, as a drawer does.
- **Crossfade**: between two layers, the open content and a rail's.

Separately, content too slow to lay out on every frame can [reflow
once](#reflowing-once) per change instead of on every frame.

### Cover and slide

Cover and slide take two wrappers: a clip layer, `getClipProps()`, which fills
the element, clips what's past its edge and pins the content to an edge, and
inside it the content wrapper, `getContentProps()`, which lays the content out
at its open size. The handles go beside the layer, not in it: they hang over the
element's edge, which the layer clips (the element itself can't clip, for the
same reason).

```tsx
import { useResizable } from "@kellanjs/use-resizable";

export function Drawer() {
  const drawer = useResizable({
    anchor: "start",
    width: {
      defaultSize: "16rem",
      defaultStop: "open",
      stops: { closed: 0, open: { min: "12rem", max: "24rem" } },
    },
  });

  return (
    <div className="flex h-screen">
      <aside {...drawer.getElementProps()} className="relative h-full">
        <div
          {...drawer.getClipProps({ slide: true })}
          className="transition-opacity duration-(--resizable-duration) ease-(--resizable-easing) data-[zero]:opacity-0"
        >
          <div {...drawer.getContentProps()} className="bg-slate-800 p-3">
            <nav>Navigation</nav>
          </div>
        </div>
        <div
          {...drawer.getHandleProps("end")}
          aria-label="Resize drawer"
          className="absolute inset-y-0 -end-1 w-2"
        />
      </aside>
      <main className="min-w-0 flex-1">
        <button onClick={() => drawer.toggle("closed")}>Toggle drawer</button>
      </main>
    </div>
  );
}
```

- **The element must be what the layer is positioned against**
  (`position: relative`, or anything else that makes it a containing block), and
  its size must come from elsewhere: its resizing along the dimensions it
  resizes, and its layout or your styles across them (`h-full` here). The layer
  takes the content out of the element's flow, so the content no longer sizes
  it. A development warning says when the layer doesn't fill its element.
- **Fading** is yours: `data-zero` on the layer (the element's own) is set as a
  change to 0 begins and cleared as one out of it begins, so a fade on it, with
  the change's timing (see [Motion](#motion)), runs alongside. It's about size,
  not stops: pulling a drawer out of an elastic 0 clears it as soon as it
  stretches, so the content fades in as it's pulled.
- **Backgrounds and borders** that should travel with the content go on the
  content wrapper (or inside it), not the element, or they stay behind.
- **Covering** pins the content to the anchored edge. A centre anchor pins it to
  the centre; a floating element (`anchor: "none"`), to its top left, where its
  position is (it doesn't slide).
- **Sliding** (`slide: true`) pins it to the moving edge for a change that
  closes the element to 0, or opens it from 0 into a range, and for a drag that
  starts at 0; anything else (a resize within the range, a move to a rail, a
  settle after an elastic pull) covers. At rest it's pinned to the anchored edge
  again. It's decided as each change begins and kept for it, taking the edge
  that moves what's shown least (the one it wants, if they're even): content
  closing from a rail, which is laid out wider than the rail, stays covered
  rather than jumping to the moving edge; and a pane reopened just after it
  began closing (a double-click on a toggle, say) covers rather than sliding in
  from 0, which it never reached. A change that interrupts another starts from
  where things are shown (measured), not where they were going: content closing
  mid-animation leaves at the size it showed. `data-sliding` is set on the layer
  while it slides.
- **In a layout**, `getClipProps(id)` pins along the child's group: the first
  (or only) child's start, the last child's end (the edge away from its
  separator), a middle child's start, or `getClipProps(id, { anchor: "end" })`
  to choose (`"start"` or `"end"`). Start and end follow the direction the layer
  inherits from its group. A child slides only along its own group's direction:
  across it (a column group closing inside a row), its content is covered. A
  grid's cells cover, at the edges they sit against (`slide` isn't offered for
  them).

> [!NOTE]
> This `anchor` is `getClipProps`' option in a layout: the edge a layout child's
> content is pinned to. It's not `useResizable`'s `anchor` option (which part of
> the element stays still), though for `useResizable` the clip layer pins to
> that anchored edge.

**Where sliding still shifts.** Every common case is continuous: toggling open
and closed, a drag that closes it, a pull out of 0, one pane opening as its
neighbour closes, a toggle interrupted by another (a double-click). Two
combinations still move the content once, landing in the right place:

- A slide that ends at a rail (dragged out of 0 to a rail, or an opening
  interrupted on its way to one) rests pinned to the anchored edge, so the
  content jumps by up to its width less the rail's. Crossfade rails instead
  (below), or cover them.
- A window resize in the middle of an opening can move its content by the
  difference it makes to where the opening ends.

### Deciding what to show

Choose content by `contentStop` and `contentSize`, not `stop` and `size`. Those
say where the element is going and how big it'll be: `stop` changes as a change
begins (closing to 0, it's `closed` from the first frame), and `size` follows a
drag frame by frame, but through an animated change it's where it's going (the
transition glides there; `size` doesn't). The content fields say what's on
screen:

| Field          | What it is                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contentStop`  | The stop whose content to show: the stop itself, except at a point at 0 (`closed: 0`), which shows nothing: there it's the stop it came from, so that content leaves with it (and if that isn't known, the one a toggle would go back to). |
| `contentSize`  | The size the content is laid out at (see [The content size](#the-content-size)).                                                                                                                                                           |
| `fromStop`     | The stop the change in progress began in: a drag, from its press until its release has settled, or an animated change until it ends. `null` while nothing is changing (and without named stops).                                           |
| `previousStop` | The stop before its latest change of stop, which stays after the change (`null` if it hasn't changed stop yet).                                                                                                                            |

`fromStop` with `stop` says what's happening: from `fromStop` to `stop`. Unlike
`previousStop`, it's about this change only, so content can move by where a
change starts and ends: travel with the edge while going to or from `closed`,
but not while settling after an elastic pull; or swap a crossfade's layers at
once coming out of `closed`, where nothing was showing. A change that interrupts
another before it's over keeps where the motion began for whatever it doesn't
move to another stop: opening a pane, then at once closing its neighbour, leaves
the pane's `fromStop` at `closed` until it's open. A drag starts afresh.

To show something at a range's minimum, a label over a pane dragged as narrow as
it goes, compare `contentSize` with the minimum (`stops.open.min`): it stays put
while the pane closes from its minimum, so the label leaves with it, and it
isn't reached on the way past by a pane closing from wider.

With `reflow: "once"`, `contentStop` and `contentSize` also wait through a drag
(see [Reflowing once](#reflowing-once)).

### Crossfading a rail

To swap the open content for a rail, stack both in a covering layer and
crossfade them on `contentStop`, which changes as soon as the resize starts, so
the fade runs alongside it (with `reflow: "once"`, a drag's waits for its
release):

```tsx
import { useResizable } from "@kellanjs/use-resizable";

export function RailSidebar() {
  const sidebar = useResizable({
    anchor: "start",
    width: {
      defaultSize: "16rem",
      defaultStop: "open",
      stops: {
        closed: { size: 0, onlyByName: true },
        rail: { size: "3.5rem", endsDrag: true },
        open: { min: "12rem", max: "28rem" },
      },
    },
  });
  const { contentStop, fromStop } = sidebar.width;
  const atRail = contentStop === "rail";
  // Coming out of 0, nothing was showing: swap at once.
  const fade =
    fromStop === "closed"
      ? ""
      : "transition-opacity duration-(--resizable-duration) ease-(--resizable-easing)";

  return (
    <aside {...sidebar.getElementProps()} className="relative h-screen">
      <div {...sidebar.getClipProps()}>
        <div
          inert={atRail}
          className={`absolute inset-0 ${fade} ${atRail ? "opacity-0" : ""}`}
        >
          <div {...sidebar.getContentProps()} className="h-full">
            <nav>Navigation</nav>
          </div>
        </div>
        <div
          inert={!atRail}
          className={`absolute inset-y-0 start-0 w-14 ${fade} ${atRail ? "" : "opacity-0"}`}
        >
          <nav>Icons</nav>
        </div>
      </div>
      <div
        {...sidebar.getHandleProps("end")}
        aria-label="Resize sidebar"
        className="absolute inset-y-0 -end-1 w-2"
      />
    </aside>
  );
}
```

- Both layers are pinned to the anchored edge (`start-0`, with
  `anchor: "start"`), so open and rail crossfade in place.
- Closing to 0 from the rail, `contentStop` stays `rail`, so the rail's layer
  leaves with the sidebar instead of swapping on the way out; coming out of
  `closed`, nothing was showing, so the layers swap without a fade (`fromStop`).
- It works the same for a layout child: take `contentStop` and `fromStop` from
  `getChild(id)` (or `elements`), and use `getClipProps(id)` and
  `getContentProps(id)`. The timing variables come from the root group.
- `inert` keeps the faded-out layer out of the tab order and the accessibility
  tree. That's React 19's `inert={atRail}`; React 18 drops a boolean `inert`
  (and its types don't have it), so there, set it as an attribute:
  `{...(atRail ? { inert: "" } : {})}`.
- The fade takes the resize's own timing from `--resizable-duration` and
  `--resizable-easing` (see [Motion](#motion)), so it stays in step with
  whatever `transition` says.

### The content size

`contentSize` is the size the wrapper lays content out at:

- **In a range**, the size itself (in a layout past its space, the size it's
  drawn at; see [Overflow](#5-overflow-and-refuseoverflow)).
- **At a point** (a rail, or 0), the size of the range it would go back to.
- **While an animated change takes it to a point**, the size the content had
  when the change began, which isn't always the size it reopens at (after a drag
  that closed it, or with siblings squeezing it), so the content leaves as it
  was rather than reflowing on the first frame. It's laid out at the reopening
  size once the change is over: unseen at 0, and at a rail, which shows some of
  it, a reflow at the end, unless it crossfades to the rail's own content.
- **An animated change that moves the element to another stop** (opening from 0,
  say) lays its content out at the size it's going to from the start, so it
  slides in whole; one that resizes it within its stop (a neighbour closing, or
  `setSize` in its range) doesn't: its content reflows with its edge, as in a
  drag, rather than jumping to where the change will end.
- **A change that interrupts another** (showing a pane alone just after it began
  opening, say) carries content that's opening or closing on at the size it's
  laid out at, which grows with the element past that size, rather than laying
  it out at once at the new destination, which would shift it: a column centred
  in it would jump to where it'll end.
- **With `reflow: "once"`**, the size it's kept at while a drag or a change
  keeps it (see [Reflowing once](#reflowing-once)).

The wrapper reads it from CSS variables on the element:
`--resizable-content-width` and `--resizable-content-height` (layout children
also set `--resizable-content-size`, along their group's direction). While it's
just the size drawn (in a range, and not kept at a fixed size), they're
`initial`, so the wrapper falls back to `100%`: a variable that changed on every
frame of a drag would restyle everything inside the element each time, since
custom properties inherit, and `initial` also keeps a nested resizable from
inheriting an outer one's.

The wrapper is never narrower than the element (`max(100%, …)`), which it
otherwise would be for a moment while a stretch past the maximum settles (the
content size jumps to the maximum; the element animates there). While reflowing
once keeps it at a fixed size, it's exactly that size.

### Divider lines

Mind how the line between a resizable and what's beside it is drawn: it changes
the room inside, and what happens at 0. Each way has its place:

- **A border** is part of the element's size (with `box-sizing: border-box`), so
  content sized to a stop (the rail's `w-14`) has a pixel less room than it
  needs, and the element can't get smaller than its border: at zero, it still
  shows a 1px line until it's hidden.
- **An inset shadow** (`shadow-[inset_-1px_0_0_…]`) takes no room and is drawn
  inside the element, over its last pixel, so it shrinks away with it: good for
  something that goes to zero, like a drawer. Content sized to a stop sits half
  a pixel off-centre against the line.
- **An outer shadow** (`shadow-[1px_0_0_…]`) takes no room and is drawn just
  outside, so all of the size is room for content: good for a rail whose icons
  should be centred. It overlaps the neighbour by a pixel (being positioned, the
  element paints over it; give it a `z-index` if the neighbour is positioned
  too), and at 0 it stays until hidden.
- **A line on the neighbour, or its own element,** isn't part of the resizable
  at all, and stays at zero, if that's what you want.

### Reflowing once

When the content is too slow to lay out on every frame (an editor, a map, a big
table), let it reflow once per change instead: `reflow: "once"`, on either hook.
The elements, handles and separators move as usual; only content laid out with
`getContentProps` waits, at a fixed size, so the browser has next to nothing to
lay out on each frame.

- **Dragging,** the content keeps the size it had when the drag started (clipped
  where its element shrinks, with room beside it where it grows).
- **Animating** (a release, Escape, `setStop`, `toggle`, `setSize`,
  `setPosition`, keys, `reset`, children added or reordered), the content is
  laid out at the larger of its sizes before and after: where its element grows,
  the new size at once, uncovered as the element opens; where it shrinks, the
  old size, covered as the element closes, and the new size once it's done. A
  release is such a change too, so content that grew takes its new size as the
  drag is let go, and content that shrank once the release has played out.
  Content closing to a point leaves at the size it had, as it does without
  `reflow: "once"` (see [The content size](#the-content-size)).

Either way, it reflows once. With `reflow: "live"` (the default), content in the
wrapper reflows on every frame instead: smoother to watch, and fine for content
that's quick to lay out.

```tsx
import { useResizableLayout } from "@kellanjs/use-resizable";

export function SlowEditor() {
  const ide = useResizableLayout({
    layout: {
      id: "ide",
      direction: "row",
      children: [{ id: "files", defaultSize: 240 }, { id: "editor" }],
    },
    reflow: "once",
  });

  return (
    <div {...ide.getGroupProps("ide")} className="h-screen">
      <nav {...ide.getElementProps("files")}>Files</nav>
      <div
        {...ide.getSeparatorProps("files", "editor")}
        aria-label="Resize files"
        className="w-px bg-neutral-300"
      />
      <main {...ide.getElementProps("editor")}>
        <div {...ide.getContentProps("editor")}>A slow editor</div>
      </main>
    </div>
  );
}
```

- **Only content in a `getContentProps` wrapper waits.** Content that fills its
  element reflows on every frame, as with `reflow: "live"`; in development,
  reflowing once with no wrapper is warned about. (Content you lay out at
  `--resizable-content-width` and `-height` yourself waits too: mark its wrapper
  `data-resizable-content`, as `getContentProps` does.)
- **It paints on its own.** While its size is fixed, the wrapper also has
  `contain: paint`, so the element resizing around it doesn't paint it again on
  every move. Meanwhile, nothing in it shows past it, and it's what anything
  positioned `absolute` or `fixed` inside it is placed against. To opt out, pass
  `getContentProps({ style: { contain: "none" } })` (in a layout,
  `getContentProps(id, { style })`).
- **Keep handles, separators and junctions beside the wrapper**, not in it:
  inside, they'd be laid out at the content size, and placed against the wrapper
  while its size is fixed.
- **Through a drag, `contentSize` and `contentStop` wait too**, so content keyed
  to them changes on release (through an animated change, `contentStop` changes
  at once, so a crossfade runs alongside). Sizes, stops and the elements'
  `data-*` follow the drag as usual.
- **A layout's elements clip their content.** A `useResizable` element doesn't
  (its handles often hang over its edge): clip a layer inside it
  (`overflow: hidden`, or `getClipProps()`) where content shouldn't show past
  it.
- **Only its own content.** `useResizable` keeps its own element's content
  still, not its neighbours': a main area beside a sidebar reflows as the
  sidebar moves. Where what's beside it is slow to lay out too, make both
  children of a layout.

## Persistence

```ts
useResizable({ …, persist: { key: "sidebar" } });
useResizableLayout({ …, persist: { key: "editor-layout" } });
```

Every committed change (not each drag frame) is saved to `localStorage` under
the key, and the saved state is restored when the element mounts. Saved data is
validated before use; anything unreadable is ignored. Storage that's missing
(the server), blocked or full never breaks resizing. `reset()` goes back to the
defaults (and saves that).

What's saved is a snapshot: for `useResizable`, each dimension's stop and its
size in each range (and a floating element's position); for a layout, each
child's stop and its size in each range. Layouts save every child they've laid
out, removed ones included, so a removed child comes back at its old size even
after a reload. Stepping down isn't saved (a child's chosen stop is).

`persist` takes `key`, `storage` and `sync`: see [Persist
options](#persist-options).

### What caused a change

`onChange(snapshot, { cause })` is called with the same changes, and what caused
each:

| `cause`                                     | What changed it                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------- |
| `"drag"`, `"keyboard"`                      | the user, dragging or with keys                                                 |
| `"stop"`, `"size"`, `"position"`, `"reset"` | your code: `setStop`, `toggle` or `setStops`; `setSize`; `setPosition`; `reset` |
| `"children"`                                | a layout's children added, removed or reordered                                 |
| `"options"`                                 | other new options that changed what's shown (`persist.key`, say)                |
| `"sync"`                                    | a change saved elsewhere, followed with `persist.sync`                          |

To keep only what the user did, for undo or analytics, say:

```ts
onChange: (snapshot, { cause }) => {
  if (cause === "drag" || cause === "keyboard") history.push(snapshot);
},
```

A button of yours that calls `toggle` is the user's doing too, but only your
code knows that: it shows as `"stop"`. `restore` doesn't call `onChange`, and
nor does stepping down.

### One layout per document

Changing `persist.key` switches to that key's saved state, or the defaults if
nothing is saved there. The switch is reported through `onChange` (it changed
what's shown; the cause is `"options"`), but nothing is saved under the new key
until the user changes something:

```ts
const editor = useResizableLayout({
  …,
  persist: { key: `editor-layout:${documentId}` },
});
```

### Across tabs

Each tab keeps its own layout, and the last one saved is what the next load
gets. With `sync: true`, a tab follows changes saved under its key elsewhere,
like another tab resizing the same layout, as they happen:

```ts
persist: { key: "editor-layout", sync: true }
```

- A followed change is reported through `onChange` (the cause is `"sync"`) but
  not saved again.
- One that arrives mid-drag waits for the drag: if it's released, the drag is
  the newest change and is kept; if it's cancelled, or a change from code
  (`setSize`, `setStop`, …) ends it, what's saved then applies (the change from
  code is saved first, being newer).
- The browser reports `localStorage` changes from other tabs on its own
  (`sessionStorage` isn't shared between tabs); other storage needs a
  `subscribe(key, onChange)` that returns an unsubscribe function (in
  development, `sync` warns without one).

### Other storage

`storage` takes anything with `getItem` and `setItem` (and, for `sync`,
`subscribe`): the `SnapshotStorage` type.

```ts
persist: { key: "sidebar", storage: sessionStorage }
```

The key names what's saved, so storage passed anew under the same key (an
adapter written inline, say) is saved to from then on, but not loaded from. To
load from other storage, change the key too.

For storage that isn't synchronous (a server, IndexedDB), skip `persist` and use
the snapshot API directly:

```tsx
import { type ResizableSnapshot, useResizable } from "@kellanjs/use-resizable";
import { useEffect } from "react";

declare function load(): Promise<ResizableSnapshot | null>;
declare function save(snapshot: ResizableSnapshot): void;

export function useSavedSidebar() {
  const sidebar = useResizable({
    anchor: "start",
    width: { defaultSize: "16rem", minSize: "12rem" },
    onChange: (snapshot) => save(snapshot),
  });
  const { restore } = sidebar;

  useEffect(() => {
    load().then((snapshot) => snapshot && restore(snapshot));
  }, [restore]);

  return sidebar;
}
```

`restore` doesn't animate, call `onChange` or save; an animated change still
under way when it's called ends, as the restored state shows at once. Validate
data you didn't just create with `isResizableSnapshot` / `isLayoutSnapshot`.

### Changes made from callbacks

Changes are made one at a time. One asked for while another is being made (from
`onChange`, `onDragEnd`, or a controller subscriber) is made once that one is
stored, saved and reported: it's the newer, so it's saved after. So inside
those, a call takes effect after you return, and is checked then, against what
the calls before it left: a `setStop` to a stop the options just changed to add
works. One that throws doesn't keep the rest from being made; its error is
thrown from the call that started them, once they are. A drag still live when
such a change is made is dropped by it (`onDragEnd` hears `cancelled`), as by
any change from code.

### Server rendering without a flash

`localStorage` is only readable in the browser, so on a server-rendered page the
saved size arrives just after hydration: the defaults show for a moment first.
(Reading storage during render instead would make the client's first render
disagree with the server's HTML.)

To avoid the flash, keep the snapshot in a cookie, which the server can read,
and pass what it read as `initialSnapshot`. With Next.js:

```ts
// sidebar-storage.ts
import type { SnapshotStorage } from "@kellanjs/use-resizable";

export const cookieStorage: SnapshotStorage = {
  getItem(key) {
    const prefix = `${encodeURIComponent(key)}=`;
    const entry = document.cookie.split("; ").find((c) => c.startsWith(prefix));
    return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
  },
  setItem(key, value) {
    document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
  },
};
```

```tsx
// layout.tsx (a server component)
import {
  type ResizableSnapshot,
  isResizableSnapshot,
} from "@kellanjs/use-resizable";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { Shell } from "./shell";

export default async function Layout({ children }: { children: ReactNode }) {
  const saved = (await cookies()).get("sidebar")?.value;
  let snapshot: ResizableSnapshot | undefined;
  try {
    const value: unknown = saved && JSON.parse(saved); // Next decodes cookie values
    if (isResizableSnapshot(value)) snapshot = value;
  } catch {}
  return <Shell sidebarSnapshot={snapshot}>{children}</Shell>;
}
```

```tsx
// shell.tsx
"use client";

import { type ResizableSnapshot, useResizable } from "@kellanjs/use-resizable";
import type { ReactNode } from "react";

import { cookieStorage } from "./sidebar-storage";

export function Shell({
  sidebarSnapshot,
  children,
}: {
  sidebarSnapshot?: ResizableSnapshot;
  children: ReactNode;
}) {
  const sidebar = useResizable({
    anchor: "start",
    width: { defaultSize: "16rem", minSize: "12rem", maxSize: "28rem" },
    initialSnapshot: sidebarSnapshot,
    persist: { key: "sidebar", storage: cookieStorage },
  });

  return (
    <div className="flex h-screen">
      <aside {...sidebar.getElementProps()} className="relative">
        <nav>Navigation</nav>
        <div
          {...sidebar.getHandleProps("end")}
          aria-label="Resize sidebar"
          className="absolute inset-y-0 -end-1 w-2"
        />
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
```

Before the browser measures anything, the server's HTML uses CSS that already
matches the saved sizes: `clamp()` for a resizable, flex proportions for a
layout. `initialSnapshot` is read once, when the hook is created.

## Motion

Committed changes animate with a CSS transition: releasing a drag (which also
settles an elastic stretch), moving between stops, keyboard steps, `setSize`,
`setPosition`, `reset`, and children added or reordered. Drags themselves follow
the pointer instantly, and changes that follow the layout (a window resize,
restoring a snapshot) don't animate. Removing a layout child is instant: its
element is gone at once, and the others easing into its space would be drawn off
their sizes on the way (to animate one out, see [Workspace of
panes](#workspace-of-panes)).

While a change transitions, `animating` is `true` (and `data-animating` is set
on the element or root group), for restyling during it: fading a sidebar's
labels as it collapses, say. It turns off once the transition's duration has
passed.

**Timing variables.** For content that should move in step with a change (a
crossfade between a sidebar's open content and its rail), the change's timing is
on the element, and on a layout's root group, as CSS variables:
`--resizable-duration` and `--resizable-easing`. They follow the timing per kind
of change and reduced motion (`0ms` when the change doesn't animate); while
dragging, they keep the drag's timing, so a stop the drag passes through fades
the way its release will animate:

```css
.layer {
  transition: opacity var(--resizable-duration) var(--resizable-easing);
}
```

**Transitions.** The default is 400ms of a strong ease-out,
`cubic-bezier(0.22, 1, 0.36, 1)`: it starts at full speed, so an animation
carrying on from a drag keeps its motion, then lands softly. `transition: false`
turns it off; otherwise you can set the timing overall, per kind of change, and
for reduced motion:

```ts
transition: {
  duration: 300,                // all changes (default 400)
  easing: "ease-out",
  changes: {
    stop: { duration: 600 },    // moving between stops: slower
    keyboard: false,            // key presses: instant
  },
  reducedMotion: { duration: 120 }, // default false: none
}
```

The kinds of change (`ChangeKind`) are `drag` (a release, or Escape), `stop`
(`setStop`, `toggle`, `setStops`), `size` (`setSize`), `position`
(`setPosition`), `keyboard`, `reset`, and in layouts, `children` (added or
reordered: a child added grows from 0 as the others make room). When the user
prefers reduced motion, changes don't animate unless `reducedMotion` gives a
transition to use instead (a kind turned off stays off). Turning transitions off
while a change plays (with `transition: false`, or the user asking for reduced
motion) ends it where it's going.

**Elastic.** The hook's `elastic` option lets a drag stretch a little past a
minimum or maximum, with resistance, and spring back on release. It's on by
default, with `{ distance: 16, tension: 0.8, afterSnap: false }`:

- `distance` is the furthest it stretches, in pixels;
- `tension`, from 0 to 1, is how stiff it feels (0 follows the pointer at first;
  1 doesn't move at all);
- `afterSnap` stretches something that snapped across a gap (and so is ahead of
  the pointer) back toward the pointer, where by default it lands at its new
  stop's edge.

Pass any of them to change them (`elastic: { distance: 24 }`), or
`elastic: false` to turn stretching off. This sets how a stretch feels; each
stop's own `elastic` sets where one happens (see [Where a size
lands](#where-a-size-lands)).

## Styling

The library sets only what it must, as inline styles:

- **`useResizable`'s element:** `width` / `height` (and `aspect-ratio` when
  locked), `box-sizing: border-box`, `flex-shrink: 0`, the transition,
  `visibility` while at zero, the `--resizable-content-*` variables (see [The
  content size](#the-content-size)), and `--resizable-duration` /
  `--resizable-easing`; a floating one also gets `position: absolute`, `left`
  and `top`.
- **`getContentProps`' wrapper:** `width` and `height` (at least the element's
  size, `max(100%, var(--resizable-content-width, 100%))`, or exactly the
  variable while reflowing once keeps it fixed), `flex-shrink: 0`, and
  `contain: paint` while its size is fixed (see [Reflowing
  once](#reflowing-once)); for `useResizable`, only along the dimensions it
  resizes.
- **`getClipProps`' layer:** `position: absolute`, `inset: 0`,
  `overflow: hidden`, and the flexbox that pins the content wrapper
  (`display: flex`, `justify-content`, `align-items`, and
  `flex-direction: column` when only the height is resized; see [Cover and
  slide](#cover-and-slide)).
- **A layout's groups:** `display: flex` and the direction, and on the root,
  `--resizable-duration` / `--resizable-easing`. On each child: `flex`,
  `min-width` / `min-height: 0`, the transition (of `flex-grow` and
  `flex-basis`), `visibility` while at zero and the `--resizable-content-*`
  variables, plus `overflow: hidden` on elements. A child at a stop with a fixed
  size (a rail, a strip, 0) is that size outright (its `flex-basis`); one in a
  range takes a share of the space (its `flex-grow`), so the browser fills the
  group exactly.
- **A grid:** `display: grid`, `position: relative`, and its templates; its
  cells, `contain: size` and `overflow: hidden`, placed on their tracks; its
  segments and junctions, placed on their lines.
- **Handles, the move handle, separators and junctions:** `touch-action: none`
  and the `cursor` (`ew-resize` / `ns-resize` on edge handles, `nwse-resize` /
  `nesw-resize` on corners, `col-resize` / `row-resize` on separators, `move` on
  the move handle and on junctions across directions; none with
  `cursor: false`). Separators also get `flex-shrink: 0`, and handles
  `visibility: visible` while the element is hidden at zero, so they can bring
  it back.

Everything else is yours ([Building blocks](#building-blocks) has handles and
separators to start from).

### Data attributes

State is exposed as data attributes for CSS:

| Attribute                             | On                                                                           | Set when                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `data-dragging`                       | `useResizable` element, handle, move handle, root group, separator, junction | being dragged (on a `useResizable` element: what's grabbed, an edge or `"move"`)     |
| `data-animating`                      | element, root group                                                          | a committed change transitions                                                       |
| `data-zero`                           | element, layout child, nested group, handle, clip layer                      | at zero (a handle: the dimension it drives)                                          |
| `data-zero`                           | separator                                                                    | `"before"`, `"after"` or `"both"`: the neighbours at zero                            |
| `data-hover`                          | separator, junction                                                          | a press under the mouse or pen would drag it (see [What lights up](#what-lights-up)) |
| `data-width-stop`, `data-height-stop` | `useResizable` element                                                       | named stops: the stop (`"rail"`)                                                     |
| `data-stop`                           | layout element, nested group, handle                                         | named stops: the stop (a handle: its dimension's)                                    |
| `data-sliding`                        | clip layer                                                                   | its content slides with the moving edge                                              |
| `data-handle`                         | handle, move handle                                                          | always: the edge it drives, or `"move"`                                              |
| `data-element`, `data-group`          | layout element, group                                                        | always: its id                                                                       |
| `data-direction`                      | group, separator                                                             | always: `"row"` or `"column"` (a separator: its group's; a grid: none)               |
| `data-grid`                           | grid                                                                         | always                                                                               |
| `data-resizable-content`              | content wrapper                                                              | always (marks it for development warnings and for reflowing once)                    |
| `data-resizable-clip`                 | clip layer                                                                   | always                                                                               |

```css
aside[data-width-stop="rail"] .label {
  display: none;
}
[role="separator"][data-dragging] {
  background: highlight;
}
```

### Cursors

During a drag the cursor is locked to the resize cursor across the whole page,
so it doesn't flicker as the pointer outruns the handle, and text can't be
selected. To set cursors yourself, pass `cursor: false`: no `cursor` in the
styles of handles, separators and junctions, and none across the page while
dragging (text selection is still blocked).

### Your own styles and refs

An inline style wins over any class, so to change one of the library's, pass
your own `style` to the prop getter; it's merged over the library's, key by key.
Every getter takes `{ style }`:

```tsx
// A tooltip that may overflow the element.
<div
  {...dashboard.getElementProps("chart", { style: { overflow: "visible" } })}
/>
```

Props also carry a `ref`. To add your own ref, merge it with `useMergedRefs`,
which stays stable across renders (a merged ref made inline would detach and
reattach the element on every render):

```tsx
import { useMergedRefs, useResizable } from "@kellanjs/use-resizable";
import { useRef } from "react";

export function ScrollingSidebar() {
  const sidebar = useResizable({
    anchor: "start",
    width: { defaultSize: "16rem", minSize: "12rem" },
  });
  const scroller = useRef<HTMLElement>(null);
  const ref = useMergedRefs(sidebar.getElementProps().ref, scroller);

  return (
    <aside {...sidebar.getElementProps()} ref={ref} className="overflow-y-auto">
      Navigation
    </aside>
  );
}
```

Outside a component, `mergeRefs(a, b, …)` does the same without memoizing.

## Accessibility

- **Labels.** Edge handles and separators are `role="separator"` with
  `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and `aria-controls`, and are
  focusable. **Add an `aria-label`** to each ("Resize sidebar"). In development,
  an unlabelled one warns.
- **Keys.** Arrows resize (Shift for a larger step); at a range's end, the next
  press jumps to the next stop, at its near edge, where a drag across would land
  (`keyboard: { jump: false }` keeps arrows within the stop). Home and End go to
  the smallest and largest reachable sizes, and Enter toggles a stop: by default
  the smallest reachable one (the window splitter pattern's "collapse"; nothing
  when only one stop is reachable), or the one `enterToggles` names (`false` for
  none). `keyboard: { step, largeStep }` sets the steps (default 10 and 50
  pixels); `keyboard: false` turns keys off and takes handles and separators out
  of the tab order.
- **A separator is about one of its neighbours**, the one before it unless you
  pass `primary: "after"` (for a panel at the end: a preview on the right, a
  terminal at the bottom). Its `aria-controls`, its value and value text, and
  what Home, End and Enter act on are that child's, so label the separator for
  it ("Resize terminal"). Arrows move the line on screen either way, and every
  key acts like dragging it: the child on the other side gives or takes the
  difference (cascading, if that's on), where `setStop` from code shares it
  among all the siblings.
- **Values.** `aria-valuemin` and `aria-valuemax` are the smallest and largest
  reachable sizes, and with named stops, `aria-valuetext` says which stop it's
  at ("rail, 56 pixels"). For your own wording or language, pass `valueText`:
  `({ stop, size }) => t("sidebar.width", { stop, size })` (with `dimension` in
  `useResizable`, and the child's `id` in a layout).
- **Corners** are hidden from assistive tech and the tab order: a corner changes
  two values, which a separator can't express, and its two edges already cover
  everything it does by keyboard. So a corner doesn't need a label (it's
  ignored, and only an unlabelled edge warns), but one does no harm: label every
  handle the same way if that's simpler.
- **Unless the edges don't:** when `handles` leaves a dimension with no edge
  handle (corners only, on an image say), the first corner that resizes it takes
  the keyboard. It's a focusable `role="slider"` (label it): its arrows move its
  edges, as a drag would, and Home, End and Enter act on its first dimension.
  Its value is that dimension's size; moving two dimensions of its own, it reads
  both in `aria-valuetext` ("width 320 pixels, height 240 pixels"), as ARIA has
  no control for two values. A ratio-locked corner sets the width alone, which
  the height follows. The other corners stay hidden, so there's one tab stop.
- **The move handle** of a floating element takes arrow keys; give it a label
  that says so.
- **Junctions** are pointer-only (`aria-hidden`, out of the tab order): each
  separator a junction drags is reachable from the keyboard on its own.
- **At zero.** Something at zero (a closed drawer, a layout element) gets
  `visibility: hidden` once its transition ends, so its content leaves the tab
  order and the accessibility tree. Handles inside it stay visible, so it can
  still be pulled open; to hide those too, don't render them (or use
  `display: none`) while it's at zero. `hideAtZero: false` turns this off (on a
  resizable, a layout, or a single layout child or cell), for content meant to
  show at 0 or for hiding it your own way.
- **Disabled.** With `disabled: true`, handles and separators are
  `aria-disabled` and leave the tab order. A separator that can't change
  anything right now is `aria-disabled` but stays focusable (see [What lights
  up](#what-lights-up)).
- **Focus is left to you.** A handle keeps focus when Enter takes its element to
  zero (it stays rendered), but if something inside the content had focus, focus
  falls back to the page. When your app sends an element to zero from inside it
  (a shortcut, a close button), move focus to whatever brings it back, usually
  its toggle.

## Performance

During a drag, the component that calls the hook re-renders once per frame
(pointer moves between frames are combined into one update), with the live sizes
in its props. Whatever it renders re-renders with it, unless React can skip it:

- With [React Compiler](https://react.dev/learn/react-compiler), content whose
  own props haven't changed is skipped for you.
- Without it, put heavy content in a component wrapped in `memo`, and render it
  inside the element. Don't pass it the element's props: they change every
  frame, so it would re-render anyway.

```tsx
import { useResizableLayout } from "@kellanjs/use-resizable";
import { memo } from "react";

const FileTree = memo(function FileTree() {
  return <ul>{/* a thousand files */}</ul>;
});

export function Editor() {
  const editor = useResizableLayout({
    layout: {
      id: "editor",
      direction: "row",
      children: [{ id: "files", defaultSize: 240 }, { id: "code" }],
    },
  });

  return (
    <div {...editor.getGroupProps("editor")} className="h-screen">
      <nav {...editor.getElementProps("files")}>
        <FileTree />
      </nav>
      <div
        {...editor.getSeparatorProps("files", "code")}
        aria-label="Resize files"
        className="w-px bg-neutral-300"
      />
      <main {...editor.getElementProps("code")}>Code</main>
    </div>
  );
}
```

The library's own work in a frame (working out the sizes, rendering the props)
is small: a fraction of a millisecond for a typical layout. Most of a drag's
cost is the browser's, laying out your content at its new size on every frame:
text rewrapping, lists reflowing. That grows with the content, not with the
library. Content that doesn't need to reflow as its element changes can be laid
out at a fixed size behind a clip instead, so the element covers and uncovers it
(see [Cover and slide](#cover-and-slide)), and content that does can [reflow
once](#reflowing-once) per change.

Only what changed is restyled: a drag frame changes the style of each child
whose size moves, and the ARIA values of the separators reporting those sizes,
and nothing inside them. To follow every change without re-rendering at all,
subscribe to the controller instead: `controller.subscribe(listener)`.

## Recipes

Each recipe is a complete component. The separators and junctions use the
classes from [Building blocks](#building-blocks).

### Sidebar with an icon rail

A sidebar 16rem wide by default, resizable between 14rem and 28rem, that snaps
to a 3.5rem icon rail when dragged narrow enough, and closes only by a button.
Its width is saved.

```tsx
import { useResizable } from "@kellanjs/use-resizable";

const RAIL = "3.5rem";

const ITEMS = [
  { href: "#home", icon: "⌂", label: "Home" },
  { href: "#projects", icon: "▦", label: "Projects" },
  { href: "#settings", icon: "⚙", label: "Settings" },
];

export function SidebarWithRail() {
  const sidebar = useResizable({
    anchor: "start",
    width: {
      defaultSize: "16rem",
      defaultStop: "open",
      stops: {
        closed: { size: 0, onlyByName: true },
        rail: { size: RAIL, endsDrag: true },
        open: { min: "14rem", max: "28rem" },
      },
    },
    persist: { key: "sidebar" },
  });
  // The stop's content, and while closed (0, nothing to show), the content
  // of the stop it closed from, so that leaves with it.
  const atRail = sidebar.width.contentStop === "rail";

  return (
    <div className="flex h-screen">
      <aside
        {...sidebar.getElementProps()}
        className="relative bg-slate-100 shadow-[1px_0_0_var(--color-slate-300)]"
      >
        {/* Clips the content, leaving the handle outside it. */}
        <div className="h-full overflow-hidden">
          <button
            onClick={() => sidebar.toggle("rail")}
            aria-expanded={sidebar.width.stop === "open"}
            aria-label={atRail ? "Expand sidebar" : "Collapse sidebar"}
            className="flex h-12 w-full items-center"
          >
            <span aria-hidden className="w-14 shrink-0 text-center">
              {atRail ? "»" : "«"}
            </span>
            {!atRail && <span>Collapse</span>}
          </button>
          <nav aria-label="Main">
            {ITEMS.map(({ href, icon, label }) => (
              <a
                key={href}
                href={href}
                aria-label={label}
                title={atRail ? label : undefined}
                className="flex h-11 items-center whitespace-nowrap"
              >
                <span aria-hidden className="w-14 shrink-0 text-center">
                  {icon}
                </span>
                {!atRail && <span>{label}</span>}
              </a>
            ))}
          </nav>
        </div>
        <div
          {...sidebar.getHandleProps("end")}
          aria-label="Resize sidebar"
          className="handle"
        />
      </aside>
      <main className="min-w-0 flex-1 p-4">
        <button onClick={() => sidebar.toggle("closed")}>Toggle sidebar</button>
      </main>
    </div>
  );
}
```

- **The rail is a stop**, so a drag between it and the open range snaps to one
  or the other, and `endsDrag` makes reaching it end the drag, as if released:
  the collapse plays out on its own. The closed stop is `onlyByName`, so only
  the button reaches it.
- **`contentStop`** picks the content, not `stop`: it stays `rail` while the
  sidebar closes from the rail, so the icons leave with it (see [Deciding what
  to show](#deciding-what-to-show)).
- **The icons sit in a column as wide as the rail** (`w-14` is 3.5rem), so they
  don't move as the sidebar opens. The divider is an outer shadow, which takes
  no room from the rail (see [Divider lines](#divider-lines)).
- **The button inside stays focusable** in both states. To crossfade the open
  content and the rail's instead of swapping them, see [Crossfading a
  rail](#crossfading-a-rail).

### IDE layout

A row of a file tree, a work column and a preview. The work column holds the
editor, which takes the space the others leave, over a terminal. The file tree
and the terminal close by buttons; the sizes are saved.

```tsx
import { useResizableLayout } from "@kellanjs/use-resizable";

const closable = (min: number) => ({
  closed: { size: 0, onlyByName: true },
  open: { min },
});

export function IdeLayout() {
  const ide = useResizableLayout({
    layout: {
      id: "ide",
      direction: "row",
      children: [
        {
          id: "files",
          defaultSize: 240,
          defaultStop: "open",
          stops: closable(160),
        },
        {
          id: "work",
          direction: "column",
          children: [
            { id: "editor", minSize: 300 }, // a height: work is a column
            {
              id: "terminal",
              defaultSize: 200,
              defaultStop: "open",
              stops: closable(100),
            },
          ],
        },
        { id: "preview", defaultSize: "30%", minSize: 200 },
      ],
    },
    persist: { key: "ide" },
  });
  const filesOpen = ide.getChild("files").stop === "open";
  const terminalOpen = ide.getChild("terminal").stop === "open";

  return (
    <div className="flex h-screen flex-col">
      <div role="toolbar" aria-label="Panes" className="flex gap-2 p-2">
        <button
          onClick={() => ide.toggle("files", "closed")}
          disabled={!ide.canToggle("files", "closed")}
          aria-expanded={filesOpen}
          aria-controls={ide.getElementProps("files").id}
        >
          Files
        </button>
        <button
          onClick={() => ide.toggle("terminal", "closed")}
          disabled={!ide.canToggle("terminal", "closed")}
          aria-expanded={terminalOpen}
          aria-controls={ide.getElementProps("terminal").id}
        >
          Terminal
        </button>
      </div>
      <div {...ide.getGroupProps("ide")} className="min-h-0 flex-1">
        <nav {...ide.getElementProps("files")} aria-label="Files">
          <div className="p-3">Files</div>
        </nav>
        <div
          {...ide.getSeparatorProps("files", "work")}
          aria-label="Resize files"
          className="separator"
        />
        <div {...ide.getGroupProps("work")}>
          <main {...ide.getElementProps("editor")}>
            <div className="p-3">Editor</div>
          </main>
          <div
            {...ide.getSeparatorProps("editor", "terminal", {
              primary: "after",
            })}
            aria-label="Resize terminal"
            className="separator"
          />
          <section {...ide.getElementProps("terminal")} aria-label="Terminal">
            <div className="p-3">Terminal</div>
          </section>
        </div>
        <div
          {...ide.getSeparatorProps("work", "preview", { primary: "after" })}
          aria-label="Resize preview"
          className="separator"
        />
        <section {...ide.getElementProps("preview")} aria-label="Preview">
          <div className="p-3">Preview</div>
        </section>
      </div>
    </div>
  );
}
```

- **Minimums are along each group's direction**: the editor's 300 is a height,
  as `work` is a column. `work` has no size options, so as the row's middle
  child it takes what the files and preview leave.
- **The panes pad an inner wrapper**, not themselves: a child at zero can't be
  smaller than its own padding.
- **The toggles live outside the panes they close**, so they stay reachable, and
  `canToggle` disables one that would be refused (see [rule
  1](#1-empty-space-one-child-takes-whats-left)).
- **`primary: "after"`** makes the terminal's and the preview's separators about
  them: their value, their keys, their label.
- A [junction](#junctions) where the files separator meets the terminal's would
  drag both at once.

### App shell that closes panes in order

A desktop shell whose panes give way in a set order as the window narrows: the
layout closes them itself (the header's button, which closes the sidebar by
hand, is there to show what a call protects: see the notes below). A row of a sidebar (300px by default, at least 180) and
a main column: a 40px header over a content row of a page (at least 280, which
can close) and a view, itself a row of a diagram (at least 240) and a panel (340
by default, at least 260, which can close). As the window narrows:

1. The diagram shrinks to its minimum, while the sidebar and the panel keep
   their sizes.
2. The page closes.
3. The panel shrinks to its minimum, then closes.
4. The sidebar shrinks to its minimum.

Widening brings everything back in the reverse order.

```tsx
import { useResizableLayout } from "@kellanjs/use-resizable";

const closable = (min: number) => ({
  closed: { size: 0, onlyByName: true },
  open: { min },
});

export function AppShell() {
  const shell = useResizableLayout({
    layout: {
      id: "shell",
      direction: "row",
      children: [
        {
          id: "sidebar",
          defaultSize: 300,
          keepSize: "yield-first", // keeps 300 until nothing else can step down
          priority: 1, // and gives way after the panel
          stops: closable(180),
        },
        {
          id: "main",
          direction: "column",
          children: [
            { id: "header", stops: { bar: 40 } },
            {
              id: "content",
              direction: "row",
              children: [
                {
                  id: "page",
                  defaultSize: 280,
                  keepSize: true, // the diagram shrinks first
                  stops: closable(280),
                  yieldTo: { open: "closed" }, // closes when there's no room
                },
                {
                  id: "view",
                  direction: "row",
                  children: [
                    { id: "diagram", minSize: 240 }, // takes the extra room
                    {
                      id: "panel",
                      defaultSize: 340,
                      keepSize: "yield-first",
                      stops: closable(260),
                      yieldTo: { open: "closed" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  });

  return (
    <div {...shell.getGroupProps("shell")} className="h-screen">
      <aside {...shell.getElementProps("sidebar")} aria-label="Sidebar">
        <div className="p-3">Sidebar</div>
      </aside>
      <div {...shell.getGroupProps("main")}>
        <header {...shell.getElementProps("header")}>
          <div className="flex h-full items-center px-3">
            <button onClick={() => shell.toggle("sidebar", "closed")}>
              Sidebar
            </button>
          </div>
        </header>
        <div {...shell.getGroupProps("content")}>
          <section {...shell.getElementProps("page")} aria-label="Page">
            <div className="p-3">Page</div>
          </section>
          <div {...shell.getGroupProps("view")}>
            <section {...shell.getElementProps("diagram")} aria-label="Diagram">
              <div className="p-3">Diagram</div>
            </section>
            <aside {...shell.getElementProps("panel")} aria-label="Panel">
              <div className="p-3">Panel</div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}
```

What it shows as the window narrows (widths in pixels; a closed pane is 0):

| Window | Sidebar | Page   | Diagram | Panel  | What happened                                                                               |
| ------ | ------- | ------ | ------- | ------ | ------------------------------------------------------------------------------------------- |
| 1400   | 300     | 280    | 480     | 340    | The diagram takes the extra room.                                                           |
| 1160   | 300     | 280    | 240     | 340    | The diagram is at its minimum: everything else is kept.                                     |
| 1100   | 300     | closed | 460     | 340    | With the sidebar and the panel at their sizes, the minimums don't fit: the page steps down. |
| 900    | 300     | closed | 260     | 340    | The diagram shrinks again.                                                                  |
| 800    | 300     | closed | 240     | 260    | Nothing else can step down: the panel gives way, to its minimum.                            |
| 700    | 300     | closed | 400     | closed | Then it steps down too.                                                                     |
| 500    | 260     | closed | 240     | closed | The sidebar gives way last.                                                                 |
| 420    | 180     | closed | 240     | closed | Everything is at its minimum.                                                               |
| 400    | 171     | closed | 229     | closed | Overflowing: drawn smaller than their minimums, in proportion.                              |

Widening goes back through the same rows. Why each option is there:

- **The sidebar and the panel are `keepSize: "yield-first"`**: they keep their
  sizes until stepping down can free no more room. With plain `keepSize: true`,
  they'd shrink to their minimums before the page closed ([rule
  2](#2-shrinking-who-gives-way)).
- **The page closes before the panel gives way**, though they're in different
  groups: stepping down treats the root and every group inside it as one list,
  and the panel keeps its size while anything in it (the page) can step down
  ([rule 4](#4-stepping-down-to-fit)).
- **The panel gives way before the sidebar** because of the sidebar's
  `priority: 1`. (Without priorities, the panel would still go first, being
  later in the layout.)
- **The page has `keepSize: true`** so the diagram shrinks first and takes the
  extra room; at its minimum by default, the page has nothing to shrink before
  it closes. A page the user widens shrinks back to 280 first.
- **The diagram has no stops**: it's the child that takes the leftover space in
  its group ([rule 1](#1-empty-space-one-child-takes-whats-left)), so it never
  closes.
- **The header button protects the sidebar**: a sidebar opened by `toggle` steps
  down last until the window narrows ([rule
  6](#6-what-a-call-protects-and-what-a-drag-keeps)). The sidebar has no
  `yieldTo`, so only the button closes it.

### Grid dashboard

Three columns and two rows: a chart across the first two columns of the top row,
stats down both rows of the last column, and a table and a log in the bottom
row. Every line can be dragged, with a junction where a column line meets the
row line. Sizes saved.

```tsx
import { useResizableLayout } from "@kellanjs/use-resizable";

const CELLS = [
  { id: "chart", label: "Chart" },
  { id: "stats", label: "Stats" },
  { id: "table", label: "Table" },
  { id: "log", label: "Log" },
] as const;

export function Dashboard() {
  const dashboard = useResizableLayout({
    layout: {
      id: "dashboard",
      columns: [
        { id: "left", minSize: 160 },
        { id: "middle", minSize: 160 },
        { id: "right", minSize: 160 },
      ],
      rows: [
        { id: "top", minSize: 120 },
        { id: "bottom", minSize: 120 },
      ],
      children: [
        { id: "chart", column: "left", columnSpan: 2, row: "top" },
        { id: "stats", column: "right", row: "top", rowSpan: 2 },
        { id: "table", column: "left", row: "bottom" },
        { id: "log", column: "middle", row: "bottom" },
      ],
    },
    persist: { key: "dashboard" },
  });

  return (
    <div {...dashboard.getGroupProps("dashboard")} className="h-screen">
      {CELLS.map(({ id, label }) => (
        <section key={id} {...dashboard.getElementProps(id)} aria-label={label}>
          <div className="p-3">{label}</div>
        </section>
      ))}
      {dashboard
        .separatorsOf("dashboard")
        .map(({ key, before, after, segment }) => (
          <div
            key={key}
            {...dashboard.getSeparatorProps(before, after, { segment })}
            aria-label={`Resize ${before}`}
            className="separator"
          />
        ))}
      {/* Junctions in a grid place themselves where their lines meet. */}
      <div
        {...dashboard.getJunctionProps([
          ["left", "middle"],
          ["top", "bottom"],
        ])}
        className="size-3"
      />
      <div
        {...dashboard.getJunctionProps([
          ["middle", "right"],
          ["top", "bottom"],
        ])}
        className="size-3"
      />
    </div>
  );
}
```

- **`separatorsOf` lists every segment** of every line: here the line between
  left and middle runs under the chart only, and the row line stops at the
  stats. Where a cell spans across a line in the middle, the line is cut in two,
  and `separatorsOf` lists both pieces; dragging either moves the whole line.
  Render them all, with `segment` passed back.
- **A grid's junctions place themselves** on the crossing of their column line
  and row line: give them a size, and they're centred there. They need to be
  above the separators' hit areas: the [separator CSS](#a-separator) has no
  `z-index` on the separator, so a `z-index` on the junction (see [A
  junction](#a-junction)) puts it on top.
- **Cells are the tracks' size**: `getChild("left")` is a column's state; cells
  have no size of their own. To close a column, give it stops (`closed: 0`) and
  `setStop("right", "closed")`.

### Bottom drawer

A drawer along the bottom of its container, closing to 0. `anchor: "bottom"`
with only `height`, so its handle is `top`.

```tsx
import { useResizable } from "@kellanjs/use-resizable";

export function BottomDrawer() {
  const drawer = useResizable({
    anchor: "bottom",
    height: {
      defaultSize: 240,
      defaultStop: "open",
      stops: {
        closed: { size: 0, endsDrag: true }, // a drag into it closes it
        open: { min: 96, max: "80%" },
      },
    },
    persist: { key: "drawer" },
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <main className="min-h-0 flex-1 p-4">
        <button onClick={() => drawer.toggle("closed")}>Toggle drawer</button>
      </main>
      <section
        {...drawer.getElementProps()}
        aria-label="Drawer"
        className="relative shadow-[inset_0_1px_0_var(--color-slate-300)]"
      >
        <div className="h-full overflow-auto p-3">Drawer content</div>
        <div
          {...drawer.getHandleProps("top")}
          aria-label="Resize drawer"
          className="absolute inset-x-0 top-0 h-3 -translate-y-1/2 transition-transform duration-(--resizable-duration) ease-(--resizable-easing) data-[zero]:-translate-y-full"
        />
      </section>
    </div>
  );
}
```

- **At zero**, the drawer's top edge lies on its container's bottom edge, so a
  handle centred on it is half cut off if the container clips. The handle has
  `data-zero` then: `data-[zero]:-translate-y-full` moves it wholly above the
  edge, with the change's timing, so it moves as the drawer closes rather than
  jumping out first.
- **The divider is an inset shadow**, which shrinks away with the drawer (see
  [Divider lines](#divider-lines)).
- **`endsDrag` on `closed`** lets a drag that reaches 0 play the close out on
  its own. Pulled open from 0, it opens into the range.

### Floating window

A window that moves and resizes inside its container, from every edge and
corner.

```tsx
import { useResizable } from "@kellanjs/use-resizable";

export function FloatingWindow() {
  const win = useResizable({
    anchor: "none",
    width: { defaultSize: 360, minSize: 240 },
    height: { defaultSize: 240, minSize: 160 },
    defaultPosition: { x: 40, y: 40 },
    confine: "container",
  });

  return (
    <div className="relative h-screen">
      <div
        {...win.getElementProps()}
        className="rounded border bg-white shadow"
      >
        <header
          {...win.getMoveHandleProps()}
          aria-label="Move window (arrow keys)"
          className="cursor-move border-b p-2"
        >
          Window
        </header>
        <div className="p-2">Content</div>
        {win.handles.map((edge) => (
          <div
            key={edge}
            {...win.getHandleProps(edge)}
            aria-label={`Resize window from the ${edge}`}
            className="handle"
          />
        ))}
      </div>
    </div>
  );
}
```

The container is `relative`, which the window is placed against; `confine` keeps
it inside (see [Floating and confined](#floating-and-confined)). The `.handle`
class from [A handle](#a-handle) places each handle on its edge or corner.

### Image in a document

An image resized from its bottom corners, keeping its aspect ratio, centred in a
document column.

```tsx
import { useResizable } from "@kellanjs/use-resizable";

export function DocumentImage({ src, alt }: { src: string; alt: string }) {
  const image = useResizable({
    anchor: "top", // centred horizontally by the document's CSS
    width: { defaultSize: "60%", minSize: 120, maxSize: "100%" },
    aspectRatio: 4 / 3,
    handles: ["bottom-left", "bottom-right"],
  });

  return (
    <div className="flex flex-col">
      {/* In a flex column, `self-center` centres it. */}
      <figure {...image.getElementProps()} className="relative self-center">
        <img src={src} alt={alt} className="h-full w-full object-cover" />
        {image.handles.map((edge) => (
          // One corner takes the keyboard, so it needs a name.
          <span
            key={edge}
            {...image.getHandleProps(edge)}
            aria-label="Resize image"
            className="handle"
          />
        ))}
      </figure>
    </div>
  );
}
```

- **`anchor: "top"`** says the image is centred across (each pixel of drag grows
  both sides), and the CSS (`self-center`) does the centring.
- **Corners only:** with no edge handle for the width, the first corner takes
  the keyboard as a slider (see [Accessibility](#accessibility)).
- **Saving the size in the document itself?** Use `onChange` and `restore` (or
  `initialSnapshot`) with the document's own storage instead of `persist`.

### Workspace of panes

Panes kept in state, with the layout's children derived from them: toggles,
showing one pane alone, and closing a pane with an animation before it's
removed.

```tsx
import {
  type ResizableLayout,
  useResizableLayout,
} from "@kellanjs/use-resizable";
import { useEffect, useState } from "react";

interface Pane {
  id: string;
  title: string;
}

const PANE_STOPS = {
  gone: { size: 0, onlyByName: true },
  strip: "2.5rem",
  open: { min: 220 },
} as const;

const INITIAL: Pane[] = [
  { id: "notes", title: "Notes" },
  { id: "outline", title: "Outline" },
  { id: "preview", title: "Preview" },
];

export function Workspace() {
  const [panes, setPanes] = useState(INITIAL);
  const [closing, setClosing] = useState<ReadonlySet<string>>(new Set());
  const workspace = useResizableLayout({
    layout: {
      id: "workspace",
      direction: "row",
      children: panes.map((pane) => ({
        id: pane.id,
        defaultStop: "open",
        stops: PANE_STOPS,
      })),
    },
    persist: { key: "workspace" },
  });

  // Show one pane alone, as one change.
  const alone = (id: string) =>
    workspace.setStops(
      Object.fromEntries(
        panes.map((pane) => [pane.id, pane.id === id ? "open" : "strip"]),
      ),
    );

  // Close a pane smoothly: send it to 0, and remove it once that's played out.
  const close = (id: string) => {
    // The last pane taking the row's space can't go to 0.
    if (!workspace.canSetStop(id, "gone")) return;
    setClosing((ids) => new Set(ids).add(id));
    workspace.setStop(id, "gone");
  };

  useEffect(() => {
    if (closing.size === 0 || workspace.animating) return;
    // Those there once the changes played out (another close can begin
    // before one ends).
    const gone = [...closing].filter(
      (id) => workspace.getChild(id)?.stop === "gone",
    );
    setPanes((all) => all.filter((pane) => !gone.includes(pane.id)));
    setClosing(new Set());
  }, [closing, workspace]);

  return (
    <div className="flex h-screen flex-col">
      <div role="toolbar" aria-label="Panes" className="flex gap-2 p-2">
        {panes.map((pane) => (
          <button
            key={pane.id}
            onClick={() => workspace.toggle(pane.id, "strip")}
            disabled={!workspace.canToggle(pane.id, "strip")}
          >
            {pane.title}
          </button>
        ))}
      </div>
      <div {...workspace.getGroupProps("workspace")} className="min-h-0 flex-1">
        {workspace.childrenOf("workspace").map((child) => (
          <PaneView
            key={child.id}
            before={child.previous}
            pane={panes.find((pane) => pane.id === child.id)!}
            workspace={workspace}
            onAlone={() => alone(child.id)}
            onClose={() => close(child.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PaneView({
  before,
  pane,
  workspace,
  onAlone,
  onClose,
}: {
  before: string | null;
  pane: Pane;
  workspace: ResizableLayout;
  onAlone: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {before && (
        <div
          {...workspace.getSeparatorProps(before, pane.id)}
          aria-label={`Resize ${before}`}
          className="separator"
        />
      )}
      <section {...workspace.getElementProps(pane.id)} aria-label={pane.title}>
        <header className="flex gap-2 p-2">
          {pane.title}
          <button onClick={onAlone}>Alone</button>
          <button onClick={onClose}>Close</button>
        </header>
      </section>
    </>
  );
}
```

- **Toggles.** One pane always stays open to take the rest of the row (see [rule
  1](#1-empty-space-one-child-takes-whats-left)), so the last open pane's toggle
  would do nothing: `canToggle` disables it. Or add a `fill` element if the
  panes may all be strips.
- **Reordering** is reordering the array: sizes travel with the panes. Removing
  a pane from `panes` removes its element; adding it back later restores its
  size.
- **`setStops` is one change**: one transition, one `onChange` and one save,
  with every pane's `fromStop` where it was before. Whether it's allowed doesn't
  depend on the order: a pane whose turn would leave the row empty waits for the
  rest, and with `refuseOverflow`, overflow is judged where they all end, not on
  the way (two panes too wide to be open together can swap). It's all or
  nothing: if one pane still can't move, or the end would overflow, none do, and
  `canSetStops` says so beforehand. Panes already there are skipped.
- **Removing animates nothing**: a removed element is gone at once. So `close`
  sends the pane to its `gone` stop at 0 first, and removes it once `animating`
  turns off. The layout remembers a removed pane at `gone`, so if it's added
  back later, it comes back at 0: open it once it's there with
  `toggle(id, "gone")`, which goes back to where it was before. To close the
  last pane too, give the row a `fill`, which takes the space when every pane is
  at 0.

### Double-click to reset

`reset` takes a child's id (or, for `useResizable`, a dimension), so a
double-click can put one child back at its default size and stop:

```tsx
<div
  {...editor.getSeparatorProps("files", "code")}
  onDoubleClick={() => editor.reset("files")}
  aria-label="Resize files"
/>
```

Which side resets is up to you: usually the child with a set default size, not
the one that takes up the rest. Drags aren't affected: a double-click doesn't
move the pointer, so it never starts one.

### Driven by code

A resizable doesn't need handles. A highlight behind a price chart can take one
stop per price and follow a slider, landing on the nearest price:

```tsx
import { useResizable } from "@kellanjs/use-resizable";

const PRICES = [10, 20, 50, 100, 200];
const placeOf = (price: number) =>
  (PRICES.indexOf(price) / (PRICES.length - 1)) * 100;

export function PriceHighlight() {
  const highlight = useResizable({
    anchor: "left", // a chart reads left to right in any language
    width: {
      defaultSize: "50%",
      stops: Object.fromEntries(
        PRICES.map((price) => [String(price), `${placeOf(price)}%` as const]),
      ),
    },
    handles: [],
  });

  return (
    <div className="relative h-40">
      <div {...highlight.getElementProps()} className="h-full bg-blue-500/20" />
      <input
        type="range"
        min={0}
        max={100}
        aria-label="Highlight up to"
        onChange={(event) =>
          highlight.setSize({ width: `${Number(event.target.value)}%` })
        }
      />
      {/* The highest price it covers. */}
      <output>{highlight.width.stop}</output>
    </div>
  );
}
```

`setSize` lands like a drag would, so the width snaps to the nearest stop, and
`width.stop` names the price.

### Keeping what stepped down

A child that steps down to fit comes back when there's room again (see [Stepping
down to fit](#4-stepping-down-to-fit)). To keep it where it stepped down to
instead, until it's opened, choose that stop for it as soon as it gets there:

```tsx
import type { ResizableLayout } from "@kellanjs/use-resizable";
import { useEffect } from "react";

export function useKeepSteppedDown(layout: ResizableLayout) {
  const { elements, setStop } = layout;

  useEffect(() => {
    for (const element of elements) {
      if (element.yieldedFrom && element.stop) {
        setStop(element.id, element.stop);
      }
    }
  }, [elements, setStop]);
}
```

It's a change like any `setStop`: saved, and reported to `onChange` (with the
cause `"stop"`). Like any call, it makes that child the protected one ([rule
6](#6-what-a-call-protects-and-what-a-drag-keeps)), so it steps down last next
time.

## Building blocks

Handles and separators are yours to draw, but most want the same few
things: a hit area wider than the line, centred on it and taking no room;
a highlight while hovered, focused or dragged; and somewhere to go when
what they resize is at zero. Here they are as plain CSS on the library's
attributes, to copy and restyle. Every state is a `data-*` attribute, so
there's nothing to branch on in your components (with Tailwind, each rule
is a `data-[…]:` variant).

### A handle

```tsx
<div {...box.getElementProps()} className="relative">
  {box.handles.map((edge) => (
    <div
      key={edge}
      {...box.getHandleProps(edge)}
      aria-label={`Resize box (${edge})`}
      className="handle"
    />
  ))}
</div>
```

```css
/* Centred on the edge or corner it drives, 8px across (24px for fingers). */
.handle {
  position: absolute;
  --reach: 8px;
}
@media (pointer: coarse) {
  .handle {
    --reach: 24px;
  }
}
.handle:is([data-handle="left"], [data-handle="right"]) {
  inset-block: 0;
  width: var(--reach);
}
.handle:is([data-handle="top"], [data-handle="bottom"]) {
  inset-inline: 0;
  height: var(--reach);
}
.handle[data-handle="left"] {
  left: 0;
  translate: -50% 0;
}
.handle[data-handle="right"] {
  right: 0;
  translate: 50% 0;
}
.handle[data-handle="top"] {
  top: 0;
  translate: 0 -50%;
}
.handle[data-handle="bottom"] {
  bottom: 0;
  translate: 0 50%;
}

/* At zero, an edge may lie against the container's, which would cut a
   centred handle in half: move it wholly onto the open side. */
.handle[data-handle="left"][data-zero] {
  translate: -100% 0;
}
.handle[data-handle="right"][data-zero] {
  translate: 100% 0;
}
.handle[data-handle="top"][data-zero] {
  translate: 0 -100%;
}
.handle[data-handle="bottom"][data-zero] {
  translate: 0 100%;
}
/* data-zero is set as a change to zero begins: move with the change. */
.handle {
  transition: translate var(--resizable-duration) var(--resizable-easing);
}

/* Corners: square, and above the edges, so where they overlap the corner
   wins. */
.handle[data-handle*="-"] {
  width: calc(var(--reach) * 1.5);
  height: calc(var(--reach) * 1.5);
  z-index: 10;
}
.handle[data-handle="top-left"] {
  top: 0;
  left: 0;
  translate: -50% -50%;
}
.handle[data-handle="top-right"] {
  top: 0;
  right: 0;
  translate: 50% -50%;
}
.handle[data-handle="bottom-left"] {
  bottom: 0;
  left: 0;
  translate: -50% 50%;
}
.handle[data-handle="bottom-right"] {
  bottom: 0;
  right: 0;
  translate: 50% 50%;
}

/* The highlight: a line along an edge, a dot at a corner. */
.handle::after {
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  border-radius: 9999px;
  transition: background-color 150ms;
}
.handle:is([data-handle="left"], [data-handle="right"])::after {
  width: 2px;
}
.handle:is([data-handle="top"], [data-handle="bottom"])::after {
  height: 2px;
}
.handle[data-handle*="-"]::after {
  width: 8px;
  height: 8px;
}
.handle:hover::after {
  background: rgb(59 130 246 / 0.5);
}
.handle:is(:focus-visible, [data-dragging])::after {
  background: rgb(59 130 246);
}
.handle:focus-visible {
  outline: none;
}
```

The element needs positioning (`relative`) for the handles to sit against;
in development, the library warns when it hasn't.

### A separator

```tsx
<div
  {...editor.getSeparatorProps("files", "code")}
  aria-label="Resize files"
  className="separator"
/>
```

```css
/* A line between two children, either way. Set the variables to fit
   (on .separator, or one separator, inline). No z-index here: that would
   make each separator a stacking context, and its hit area and junctions
   couldn't rise above the next separator's (see Junctions). */
.separator {
  --separator-line: 1px; /* the line's thickness, which it takes up */
  --separator-reach: 4px; /* how far the hit area reaches past each side */
  --separator-offset: 0px; /* moves the hit area and highlight along the
                              group: + toward the child after it */
  --separator-color: rgb(0 0 0 / 0.1);
  --separator-highlight: rgb(59 130 246);
  --_shift: var(--separator-offset);
  position: relative;
  background: var(--separator-color);
}
.separator[data-direction="row"] {
  width: var(--separator-line);
}
.separator[data-direction="column"] {
  height: var(--separator-line);
}

/* Next to a child at zero, the line can lie against the group's edge or
   another separator: the hit area moves wholly onto the open side, above
   the others. ("both": neither side is open, so it stays put.) */
.separator[data-zero="before"] {
  --_shift: calc(var(--separator-offset) + var(--separator-reach));
}
.separator[data-zero="after"] {
  --_shift: calc(var(--separator-offset) - var(--separator-reach));
}

/* The hit area: --separator-reach each side of the line, taking no room.
   In a row, start and end follow the direction (right to left, "after"
   is to the left). */
.separator::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 10;
}
.separator:is([data-zero="before"], [data-zero="after"])::before {
  z-index: 20;
}
.separator[data-direction="row"]::before {
  inset-inline-start: calc(var(--_shift) - var(--separator-reach));
  inset-inline-end: calc(-1 * var(--_shift) - var(--separator-reach));
}
.separator[data-direction="column"]::before {
  top: calc(var(--_shift) - var(--separator-reach));
  bottom: calc(-1 * var(--_shift) - var(--separator-reach));
}

/* The highlight: 1px each side of the line (moved with the offset), on
   everything a press would drag (data-hover, not :hover; see What lights
   up). */
.separator::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 10;
  pointer-events: none;
  transition: background-color 150ms;
}
.separator[data-direction="row"]::after {
  inset-inline-start: calc(var(--separator-offset) - 1px);
  inset-inline-end: calc(-1 * var(--separator-offset) - 1px);
}
.separator[data-direction="column"]::after {
  top: calc(var(--separator-offset) - 1px);
  bottom: calc(-1 * var(--separator-offset) - 1px);
}
.separator[data-hover]::after {
  background: color-mix(in srgb, var(--separator-highlight) 60%, transparent);
}
.separator:is(:focus-visible, [data-dragging])::after {
  background: var(--separator-highlight);
}
.separator:focus-visible {
  outline: none;
}
```

For touch, a larger `--separator-reach` makes the hit area bigger
without changing the line. The whole hit area is `2 × reach + line`
wide.

### A junction

Put a junction inside one of the separators it drags, where the others
cross it, so it moves with that line. It can go anywhere, but then you
place it yourself (see [Junctions](#junctions)):

```tsx
<div
  {...ide.getSeparatorProps("editor", "terminal", { primary: "after" })}
  aria-label="Resize terminal"
  className="separator"
>
  <div
    {...ide.getJunctionProps(
      [
        ["files", "work"],
        ["editor", "terminal"],
      ],
      // This line's start. Given to the getter, so it's merged with the
      // library's styles rather than replacing them.
      { style: { insetInlineStart: 0, top: "50%" } },
    )}
    className="junction"
  />
</div>
```

```css
/* 12px square, centred on the point you place it at, above every hit
   area. */
.junction {
  position: absolute;
  width: 12px;
  height: 12px;
  translate: -50% -50%;
  z-index: 30;
}
/* Placed from the start, right to left, it's centred from the right. */
.junction:dir(rtl) {
  translate: 50% -50%;
}
```

Its separators light up with it, so it needs no highlight of its own; to
give it one, it has `data-hover` and `data-dragging` too.

## Reference

Types named here are exported from `@kellanjs/use-resizable` (see
[Exports](#exports)). `Id` is a layout's ids, typed from its options.

### `useResizable` options

`useResizable(options: UseResizableOptions)`. `anchor`, and `width` or `height`
(or both), are required.

| Option            | Type                                                                                | Default                                            | What it does                                                               |
| ----------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| `anchor`          | `Anchor`: `"left"`, `"top-right"`, `"start"`, `"bottom-end"`, `"center"`, `"none"`… | required                                           | Which part stays still while it resizes ([Anchors](#anchors-and-handles)). |
| `width`           | `DimensionOptions`                                                                  | not resizable                                      | Makes the width resizable ([Dimension options](#dimension-options)).       |
| `height`          | `DimensionOptions`; with `aspectRatio`, only `minSize` and `maxSize`                | not resizable                                      | Makes the height resizable.                                                |
| `aspectRatio`     | `number` (> 0)                                                                      | not locked                                         | Locks width ÷ height; needs `width` ([Aspect ratio](#aspect-ratio)).       |
| `cornerDrag`      | `"nearest" \| "axis"`                                                               | `"nearest"`                                        | With `aspectRatio`: how a corner follows the pointer.                      |
| `handles`         | `readonly (HandleEdge \| LogicalHandleEdge)[]`                                      | every edge and corner the anchor allows            | Offers fewer handles; one the anchor doesn't allow throws.                 |
| `defaultPosition` | `{ x?: SizeValue; y?: SizeValue }`                                                  | `{ x: 0, y: 0 }`                                   | `anchor: "none"`: where it starts ([Floating](#floating-and-confined)).    |
| `confine`         | `"container"`                                                                       | not confined                                       | `anchor: "none"`: keeps it inside its container.                           |
| `containerRef`    | `RefObject<Element \| null>`                                                        | the element's parent                               | What `%` sizes and a floating position are relative to.                    |
| `id`              | `string`                                                                            | generated (`useId`)                                | The element's DOM id, which handles point to (`aria-controls`).            |
| `valueText`       | `(value: { dimension; stop; size }) => string \| undefined`                         | `"rail, 56 pixels"` with named stops; none without | A handle's `aria-valuetext` ([Accessibility](#accessibility)).             |
| `remote`          | `ResizableRemote`                                                                   | none                                               | Attaches it to a remote while mounted ([Remotes](#remotes)).               |

It also takes the [options both hooks share](#options-both-hooks-share).

### Dimension options

`width` and `height`: `DimensionOptions`. Each needs `defaultSize`,
`defaultStop`, or both. `minSize`/`maxSize` and `stops` can't be combined
(throws).

| Option         | Type                        | Default                                                      | What it does                                                                |
| -------------- | --------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `defaultSize`  | `SizeValue`                 | a range's minimum (with `defaultStop`)                       | The size before the user resizes it ([Sizes](#sizes)).                      |
| `defaultStop`  | `string` (a stop's name)    | wherever `defaultSize` lands                                 | The stop to start at ([Moving between stops](#moving-between-stops)).       |
| `minSize`      | `SizeBound`                 | `0`                                                          | The one range's minimum, without `stops`.                                   |
| `maxSize`      | `SizeBound`                 | unbounded                                                    | The one range's maximum, without `stops`.                                   |
| `stops`        | `Record<string, StopValue>` | one range, `minSize` to `maxSize`                            | Named points and ranges ([Stops](#stops), [Stop options](#stop-options)).   |
| `enterToggles` | `string \| false`           | the smallest stop a drag can reach, if there are two or more | The stop Enter toggles; `false` for none ([Accessibility](#accessibility)). |
| `wins`         | `"min" \| "max"`            | `"min"`                                                      | Which limit wins when a minimum and maximum conflict ([Sizes](#sizes)).     |

### Stop options

A stop (`StopValue`) is a size (a point), `{ size, … }` (a point with options:
`PointStopOptions`), or `{ min, max, … }` (a range: `RangeStopOptions`).

| Option       | Type                                               | Default                                 | What it does                                                                                       |
| ------------ | -------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `size`       | `SizeValue`                                        | required for a point                    | A point's size.                                                                                    |
| `min`        | `SizeBound`                                        | `0`                                     | A range's minimum.                                                                                 |
| `max`        | `SizeBound`                                        | unbounded                               | A range's maximum.                                                                                 |
| `pull`       | `number` (> 0)                                     | `1`                                     | How much of the gaps beside it the stop claims ([Where a size lands](#where-a-size-lands)).        |
| `onlyByName` | `boolean`                                          | `false`                                 | Reached only by naming it: `setStop`, `toggle`, Enter with `enterToggles`, or stepping down to it. |
| `endsDrag`   | `boolean`                                          | `false`                                 | Landing in it ends the drag, as if released.                                                       |
| `elastic`    | `boolean \| "larger" \| "smaller"` (`StopElastic`) | `true` for a range, `false` for a point | Which ways a drag stretches past its edges (not how it feels: that's the hook's `elastic`).        |

### `useResizableLayout` options

`useResizableLayout(options: UseResizableLayoutOptions)`. `layout` is required.

| Option               | Type                                                 | Default                                            | What it does                                                                                           |
| -------------------- | ---------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `layout`             | `LayoutRootOptions`: a group or a grid               | required                                           | The layout's root ([Group options](#group-options), [Grid options](#grid-options)).                    |
| `cascade`            | `boolean`                                            | `true`                                             | Whether a drag pushes on past a neighbour that can't move further ([Dragging](#dragging-a-separator)). |
| `disabledSeparators` | `readonly (readonly [Id, Id])[]`                     | `[]`                                               | Separators the user can't move ([Locking](#locking-and-disabling)).                                    |
| `idPrefix`           | `string`                                             | generated (`useId`)                                | Prefix of the DOM ids of elements and groups: `<prefix>-files`.                                        |
| `valueText`          | `(value: { id; stop; size }) => string \| undefined` | `"rail, 56 pixels"` with named stops; none without | A separator's `aria-valuetext`; `id` is its primary neighbour.                                         |
| `remote`             | `LayoutRemote`                                       | none                                               | Attaches it to a remote while mounted ([Remotes](#remotes)).                                           |

It also takes the [options both hooks share](#options-both-hooks-share).

### Group options

The root group and nested groups (`LayoutGroupOptions`; nested:
`LayoutNestedGroupOptions`). A nested group also takes the [child
options](#child-options) for its own size in its parent.

| Option           | Type                            | Default  | What it does                                                                                                        |
| ---------------- | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `id`             | `string`                        | required | Unique in the layout, not empty.                                                                                    |
| `direction`      | `"row" \| "column"`             | required | Lays children out in a row (left to right, or right to left) or a column (top to bottom).                           |
| `children`       | `readonly LayoutChildOptions[]` | required | Its elements, groups and grids, in order.                                                                           |
| `refuseOverflow` | `boolean`                       | `false`  | Calls that would squeeze its children past their minimums are refused ([Overflow](#5-overflow-and-refuseoverflow)). |

### Child options

Each child of a group: an element (`LayoutElementOptions`), a nested group, or a
nested grid. Sizes are along the group's direction. A `fill` element takes only
`id`, `fill` and `hideAtZero`.

| Option         | Type                               | Default                                                                                          | What it does                                                                                                                                       |
| -------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | `string`                           | required                                                                                         | Identifies it across renders, reorders and snapshots. Unique in the layout, not empty.                                                             |
| `defaultSize`  | `SizeValue`                        | an equal share: of what the others leave, on the first layout; of the whole space, joining later | Its size when it first appears.                                                                                                                    |
| `defaultStop`  | `string`                           | where `defaultSize` lands; without one, the roomiest stop                                        | The stop to start at.                                                                                                                              |
| `minSize`      | `SizeBound`                        | `0`                                                                                              | The one range's minimum, without `stops`.                                                                                                          |
| `maxSize`      | `SizeBound`                        | unbounded                                                                                        | The one range's maximum, without `stops`. `100%` or more never stops it.                                                                           |
| `stops`        | `Record<string, StopValue>`        | one range, `minSize` to `maxSize`                                                                | Named points and ranges ([Stops](#stops)).                                                                                                         |
| `enterToggles` | `string \| false`                  | the smallest stop a drag can reach, if there are two or more                                     | The stop Enter toggles on a separator about it.                                                                                                    |
| `wins`         | `"min" \| "max"`                   | `"min"`                                                                                          | Which limit wins when they conflict, its children's needs included ([Sizes](#sizes)).                                                              |
| `keepSize`     | `boolean \| "yield-first"`         | `false`                                                                                          | Keeps its size while others give way ([rules 2](#2-shrinking-who-gives-way), [3](#3-growing-who-takes-extra-space), [4](#4-stepping-down-to-fit)). |
| `priority`     | `number`                           | `0`                                                                                              | Lower gives way first ([rule 2](#2-shrinking-who-gives-way)) and steps down first ([rule 4](#4-stepping-down-to-fit)).                             |
| `grow`         | `number` (≥ 0)                     | none                                                                                             | Its share of extra space, as CSS `flex-grow` ([rule 3](#3-growing-who-takes-extra-space)).                                                         |
| `yieldTo`      | `Record<string, string>`           | `{}`: never steps down                                                                           | For each stop, the stop it may step down to ([rule 4](#4-stepping-down-to-fit)).                                                                   |
| `locked`       | `boolean`                          | `false`                                                                                          | The user can't resize it ([Locking](#locking-and-disabling)).                                                                                      |
| `hideAtZero`   | `boolean`                          | the layout's                                                                                     | Hidden while it rests at 0 ([Accessibility](#accessibility)).                                                                                      |
| `fill`         | `"first" \| "last"` (`LayoutFill`) | not a fill                                                                                       | Elements only: takes what its siblings leave, with no size options ([Fills](#fills)).                                                              |

### Grid options

A grid (`LayoutGridOptions`) as the root, a child of a group, or a cell. A
nested grid also takes the [child options](#child-options) for its own size.

| Option           | Type                            | Default  | What it does                                                                      |
| ---------------- | ------------------------------- | -------- | --------------------------------------------------------------------------------- |
| `id`             | `string`                        | required | Unique in the layout.                                                             |
| `columns`        | `readonly LayoutTrackOptions[]` | required | Its columns, left to right (right to left in a right-to-left page); at least one. |
| `rows`           | `readonly LayoutTrackOptions[]` | required | Its rows, top to bottom; at least one.                                            |
| `children`       | `readonly LayoutCellOptions[]`  | required | Its cells.                                                                        |
| `refuseOverflow` | `boolean`                       | `false`  | As a group's, for its columns and rows.                                           |

**Tracks** (`LayoutTrackOptions`): every [child option](#child-options) but
`hideAtZero` (cells hide, not tracks): `id`, sizes, stops, `keepSize`,
`priority`, `grow`, `yieldTo`, `enterToggles`, `locked`, `fill`. A column's
sizes are widths, a row's heights.

**Cells** (`LayoutCellOptions`):

| Option                        | Type                     | Default      | What it does                                        |
| ----------------------------- | ------------------------ | ------------ | --------------------------------------------------- |
| `id`                          | `string`                 | required     | Unique in the layout.                               |
| `column`                      | `string` (a column's id) | required     | The first column it's in.                           |
| `row`                         | `string` (a row's id)    | required     | The first row it's in.                              |
| `columnSpan`                  | `number` (whole, ≥ 1)    | `1`          | How many columns it spans.                          |
| `rowSpan`                     | `number` (whole, ≥ 1)    | `1`          | How many rows it spans.                             |
| `hideAtZero`                  | `boolean`                | the layout's | Hidden while it rests at 0 either way.              |
| `direction`, `children`       | as a group's             | an element   | Makes the cell a group (with `refuseOverflow` too). |
| `columns`, `rows`, `children` | as a grid's              | an element   | Makes the cell a grid.                              |

Cells take no size options: a cell is as big as the tracks it spans. Two cells
in one place, or a span past the last track, throw.

### Options both hooks share

| Option            | Type                                                 | Default                                                                   | What it does                                                                                                   |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `elastic`         | `boolean \| ElasticOptions`                          | `true`: `{ distance: 16, tension: 0.8, afterSnap: false }`                | How a drag stretches past a limit, or `false` for no stretch ([Motion](#motion)).                              |
| `transition`      | `boolean \| TransitionOptions`                       | `true`: 400ms `cubic-bezier(0.22, 1, 0.36, 1)`; none under reduced motion | How committed changes animate, or `false` for none ([Motion](#motion)).                                        |
| `keyboard`        | `boolean \| KeyboardOptions`                         | `true`: `{ step: 10, largeStep: 50, jump: true }`                         | Keyboard resizing, or `false` for none ([Accessibility](#accessibility)).                                      |
| `dragThreshold`   | `number` (pixels)                                    | `2`                                                                       | How far the pointer moves before a drag starts.                                                                |
| `cursor`          | `boolean`                                            | `true`                                                                    | Sets resize cursors, and locks the page's while dragging ([Cursors](#cursors)).                                |
| `reflow`          | `"live" \| "once"` (`Reflow`)                        | `"live"`                                                                  | How often wrapped content reflows ([Reflowing once](#reflowing-once)).                                         |
| `hideAtZero`      | `boolean`                                            | `true`                                                                    | Hides what rests at 0 (`visibility: hidden`) ([Accessibility](#accessibility)).                                |
| `disabled`        | `boolean`                                            | `false`                                                                   | No handle, separator or junction takes a press or a key; calls still work ([Locking](#locking-and-disabling)). |
| `persist`         | `PersistOptions`                                     | not saved                                                                 | Saves each committed change and restores it on mount ([Persistence](#persistence)).                            |
| `initialSnapshot` | `ResizableSnapshot` / `LayoutSnapshot`               | the defaults                                                              | Saved state to start from, read once ([Server rendering](#server-rendering-without-a-flash)).                  |
| `onChange`        | `(snapshot, change: { cause: ChangeCause }) => void` | none                                                                      | Each committed change, not mid-drag ([What caused a change](#what-caused-a-change)).                           |
| `onDragStart`     | `(grabbed) => void`                                  | none                                                                      | A drag started.                                                                                                |
| `onDragEnd`       | `(grabbed, end: { cancelled: boolean }) => void`     | none                                                                      | A drag ended: released, or cancelled (Escape, unmounting, or a change from code).                              |

`grabbed` is, for `useResizable`, the edge grabbed or `"move"` (`DragTarget`);
for a layout, the separators being dragged, `{ before, after }[]` (several, from
a junction).

**`ElasticOptions`**: `distance` (pixels, default 16), `tension` (0 to 1,
default 0.8), `afterSnap` (default `false`). What you leave out keeps its
default.

**`TransitionOptions`**: `duration` (milliseconds, default 400), `easing` (CSS,
default `cubic-bezier(0.22, 1, 0.36, 1)`), `changes` (per `ChangeKind`, a timing
or `false`), `reducedMotion` (a timing, or `false`, the default, for none).

**`KeyboardOptions`**: `step` (pixels per arrow, default 10), `largeStep` (with
Shift, default 50), `jump` (arrows go on to the next stop at a stop's edge,
default `true`).

#### Persist options

| Option    | Type              | Default        | What it does                                                                                                           |
| --------- | ----------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `key`     | `string`          | required       | The storage key; changing it switches to that key's saved state ([One layout per document](#one-layout-per-document)). |
| `storage` | `SnapshotStorage` | `localStorage` | Anything with `getItem` and `setItem` (and `subscribe`, for `sync`) ([Other storage](#other-storage)).                 |
| `sync`    | `boolean`         | `false`        | Follows changes saved under the key elsewhere, like another tab ([Across tabs](#across-tabs)).                         |

### What `useResizable` returns

| Field        | Type                                               | What it is                                                                                                   |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `width`      | `ResizableDimension \| null`                       | The width's state (below); `null` if the width isn't resizable. Typed non-null when configured.              |
| `height`     | `ResizableDimension \| null`                       | The height's; with `aspectRatio`, it follows the width.                                                      |
| `position`   | `{ x: number \| null; y: number \| null } \| null` | `anchor: "none"`: where it is, in pixels from the container's top-left (`null` until measured); else `null`. |
| `dragging`   | `HandleEdge \| "move" \| null`                     | What's being dragged.                                                                                        |
| `animating`  | `boolean`                                          | A committed change is still transitioning.                                                                   |
| `handles`    | `readonly HandleEdge[]`                            | The physical edges and corners it offers handles for, for rendering them in a loop.                          |
| `controller` | `ResizableController`                              | The controller underneath ([Without React](#without-react)).                                                 |

**`ResizableDimension`** (and a layout child's state, below, which adds `id` and
`yieldedFrom`):

| Field          | Type                                 | What it is                                                                                                                |
| -------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `size`         | `number \| null`                     | The size in pixels; `null` until measured. Through an animated change, where it's going.                                  |
| `stop`         | `Stop \| null`                       | The stop it's in; `null` without named stops (and before measuring, when that depends on `defaultSize`).                  |
| `previousStop` | `Stop \| null`                       | The stop before its latest change of stop.                                                                                |
| `fromStop`     | `Stop \| null`                       | The stop the change in progress began in; `null` at rest.                                                                 |
| `stops`        | `Record<Stop, { min, max }> \| null` | Each named stop in pixels as it is now (`min` equals `max` for a point); `{}` without named stops; `null` until measured. |
| `contentSize`  | `number \| null`                     | The size its content is laid out at ([The content size](#the-content-size)).                                              |
| `contentStop`  | `Stop \| null`                       | The stop whose content to show ([Deciding what to show](#deciding-what-to-show)).                                         |

`Stop` is the stop names from your options.

| Method                           | What it does                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `getElementProps(options?)`      | Props for the element.                                                                            |
| `getContentProps(options?)`      | Props for a wrapper around its content ([Content while it resizes](#content-while-it-resizes)).   |
| `getClipProps(options?)`         | Props for a clip layer; `options.slide` slides the content ([Cover and slide](#cover-and-slide)). |
| `getHandleProps(edge, options?)` | Props for a handle that drives `edge` (`HandleEdge \| LogicalHandleEdge`).                        |
| `getMoveHandleProps(options?)`   | `anchor: "none"`: props for the move handle.                                                      |
| `setStop(stop, dimension?)`      | Goes to a stop ([Moving between stops](#moving-between-stops)); throws for an unknown stop.       |
| `toggle(stop, dimension?)`       | Goes to a stop, or back from it.                                                                  |
| `setSize({ width?, height? })`   | Asks for sizes (`SizeValue`), landing like a drag; before measuring, waits for it.                |
| `setPosition({ x?, y? })`        | `anchor: "none"`: moves it.                                                                       |
| `reset(dimension?)`              | Back to the defaults (all, or one dimension), animated and saved.                                 |
| `getSnapshot()`                  | The saveable state: `ResizableSnapshot`.                                                          |
| `restore(snapshot)`              | Shows a snapshot at once, without animating, calling `onChange` or saving.                        |

Every getter's `options` takes `{ style }`, merged over the library's styles
([Your own styles](#your-own-styles-and-refs)).

### What `useResizableLayout` returns

| Field         | Type                     | What it is                                                                                 |
| ------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| `elements`    | `ResizableLayoutChild[]` | Every element in a group, in reading order (not groups, grids, tracks, or a grid's cells). |
| `dragging`    | `{ before; after }[]`    | The separators being dragged.                                                              |
| `animating`   | `boolean`                | A committed change is still transitioning (also `data-animating` on the root group).       |
| `overflowing` | `boolean`                | Some group's minimums don't fit its space ([Overflow](#5-overflow-and-refuseoverflow)).    |
| `controller`  | `LayoutController`       | The controller underneath ([Without React](#without-react)).                               |

**`ResizableLayoutChild`**, from `getChild(id)` and `elements`: `id`,
`yieldedFrom` (while stepped down, the stop chosen for it, which is saved and
which it goes back to; else `null`), and every field of
[`ResizableDimension`](#what-useresizable-returns) above, along its group's
direction. In a group past its space, `contentSize` is the size it's drawn at,
smaller than `size`.

| Method                                       | Returns                             | What it does                                                                                                                                         |
| -------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getGroupProps(id, options?)`                | props                               | For a group's element (the root's too) or a grid's, by its id.                                                                                       |
| `getElementProps(id, options?)`              | props                               | For an element, or a grid's cell.                                                                                                                    |
| `getContentProps(id, options?)`              | props                               | For a wrapper around an element's content.                                                                                                           |
| `getClipProps(id, options?)`                 | props                               | For a clip layer; `options.slide`, and `options.anchor` (`"start" \| "end"`) to choose the edge.                                                     |
| `getSeparatorProps(before, after, options?)` | props                               | For the separator between two neighbours; `options.primary` (`"before"`, the default, or `"after"`) and, in a grid, `options.segment` (default `0`). |
| `getJunctionProps(separators, options?)`     | props                               | For a junction dragging `separators` (`readonly [before, after][]`).                                                                                 |
| `childrenOf(id)`                             | `{ id; kind; previous }[]`          | A group's children (`kind`: `"element"`, `"group"` or `"grid"`), or a grid's cells ([Rendering a tree](#groups-in-groups)).                          |
| `separatorsOf(id)`                           | `{ key; before; after; segment }[]` | A group's separators, or every segment of a grid's lines.                                                                                            |
| `getChild(id)`                               | `ResizableLayoutChild \| undefined` | An element, a nested group or grid, or a track. Typed without `undefined` for an id surely in the options ([Types](#types)).                         |
| `setStop(id, stop)`                          | `void`                              | Moves a child to a stop; its siblings make room. Throws for an unknown stop.                                                                         |
| `toggle(id, stop)`                           | `void`                              | Moves it to a stop, or back from it.                                                                                                                 |
| `setStops({ [id]: stop })`                   | `void`                              | Several at once, as one change; all or nothing ([Workspace of panes](#workspace-of-panes)).                                                          |
| `canSetStop(id, stop)`                       | `boolean`                           | Whether `setStop` would change anything: `false` if it wouldn't, if it's refused, or for an unknown id.                                              |
| `canToggle(id, stop)`                        | `boolean`                           | Whether `toggle` would.                                                                                                                              |
| `canSetStops({ [id]: stop })`                | `boolean`                           | Whether `setStops` would.                                                                                                                            |
| `setSize(id, size)`                          | `void`                              | Asks for a child's size (`SizeValue`), landing like a drag; its siblings make room.                                                                  |
| `reset(id?)`                                 | `void`                              | Back to the defaults; with a child's id, just that child, its siblings making room.                                                                  |
| `getSnapshot()`                              | `LayoutSnapshot`                    | The saveable state.                                                                                                                                  |
| `restore(snapshot)`                          | `void`                              | Shows a snapshot at once, without animating, calling `onChange` or saving.                                                                           |

### Props

What each getter returns, to spread onto your element. Add your own `aria-label`
to handles and separators.

| Getter               | Props                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getElementProps`    | `ref`, `id`, `style`; `data-width-stop`, `data-height-stop`, `data-dragging`, `data-animating`, `data-zero` (`useResizable`); `data-element`, `data-stop`, `data-zero` (layout)                                                                                                            |
| `getGroupProps`      | `ref`, `id`, `style`, `data-group`, `data-direction`, `data-grid`, `data-stop`, `data-zero`, `data-dragging`, `data-animating`                                                                                                                                                             |
| `getHandleProps`     | `ref`, `role` (`"separator"`, or `"slider"` for a corner taking the keyboard), `tabIndex`, `style`, `aria-controls`, `aria-orientation`, `aria-valuenow`, `-valuemin`, `-valuemax`, `-valuetext`, `aria-disabled`, `aria-hidden`, `data-handle`, `data-dragging`, `data-zero`, `data-stop` |
| `getMoveHandleProps` | `ref`, `tabIndex`, `style`, `aria-disabled`, `data-handle` (`"move"`), `data-dragging`                                                                                                                                                                                                     |
| `getSeparatorProps`  | `ref`, `role` (`"separator"`), `tabIndex`, `style`, `aria-controls`, `aria-orientation`, `aria-valuenow`, `-valuemin`, `-valuemax`, `-valuetext`, `aria-disabled`, `data-direction`, `data-dragging`, `data-hover`, `data-zero`                                                            |
| `getJunctionProps`   | `ref`, `tabIndex` (-1), `aria-hidden`, `style`, `data-dragging`, `data-hover`                                                                                                                                                                                                              |
| `getContentProps`    | `style`, `data-resizable-content`                                                                                                                                                                                                                                                          |
| `getClipProps`       | `ref`, `style`, `data-resizable-clip`, `data-zero`, `data-sliding`                                                                                                                                                                                                                         |

The attributes are described in [Data attributes](#data-attributes), and the
styles in [Styling](#styling).

### CSS variables

Set on a `useResizable` element, and on a layout's root group (the timing) and
children (the content sizes):

| Variable                     | What it is                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `--resizable-duration`       | The current change's duration (`0ms` when it doesn't animate; a drag's timing while dragging) ([Motion](#motion)). |
| `--resizable-easing`         | The current change's easing.                                                                                       |
| `--resizable-content-width`  | The content width, or `initial` while it's just the size drawn ([The content size](#the-content-size)).            |
| `--resizable-content-height` | The content height, likewise.                                                                                      |
| `--resizable-content-size`   | Layout children: the content size along their group's direction.                                                   |

The separator in [Building blocks](#a-separator) adds its own `--separator-*`
variables, which are yours.

### Remotes

A resizable is often controlled from somewhere that doesn't render it: a toolbar
button that toggles the sidebar, a keyboard shortcut, a command palette, a dock
showing which panels are open. A **remote** connects them. Make one where both
sides can import it, give it to the hook, and reach the resizable through it
from anywhere:

```tsx
// sidebar.tsx
import {
  type UseResizableOptions,
  createResizableRemote,
  useResizable,
} from "@kellanjs/use-resizable";

const sidebarOptions = {
  anchor: "start",
  width: {
    defaultSize: "16rem",
    stops: { closed: 0, open: { min: "12rem", max: "28rem" } },
  },
} as const satisfies UseResizableOptions;

export const sidebarRemote = createResizableRemote<typeof sidebarOptions>();

export function Sidebar() {
  const sidebar = useResizable({
    ...sidebarOptions,
    persist: { key: "sidebar" },
    remote: sidebarRemote,
  });

  return (
    <aside {...sidebar.getElementProps()} className="relative">
      <nav>Navigation</nav>
      <div
        {...sidebar.getHandleProps("end")}
        aria-label="Resize sidebar"
        className="handle"
      />
    </aside>
  );
}
```

```tsx
// toolbar.tsx
import { useResizableRemote } from "@kellanjs/use-resizable";

import { sidebarRemote } from "./sidebar";

export function SidebarButton() {
  const open = useResizableRemote(
    sidebarRemote,
    (view) => view?.width.stop === "open",
  );
  return (
    <button
      aria-pressed={open}
      onClick={() => sidebarRemote.current?.toggle("closed")}
    >
      Sidebar
    </button>
  );
}
```

The remote is only the connection: the sizes, the options and what's saved stay
with the hook that renders the resizable. While that's mounted, `remote.current`
reaches it; before it mounts, after it unmounts and on the server, it's `null`,
and calls through `?.` do nothing (they aren't queued for later). What it
reaches:

| On `remote.current`                                               | What it does                                                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `getView()`                                                       | What the hook returns, without the props and methods: the controller's view ([Without React](#without-react)). |
| `setStop`, `toggle`, `setSize`, `reset`, `getSnapshot`, `restore` | As the hook's.                                                                                                 |
| `setPosition`                                                     | `useResizable`, `anchor: "none"`.                                                                              |
| `setStops`, `canSetStop`, `canToggle`, `canSetStops`              | Layouts: as the hook's, but reading the layout as it is when called.                                           |

`remote.subscribe(listener)` calls `listener` when a resizable attaches or
detaches, and on every change to the attached one; it returns an unsubscribe
function. Read `current` when you act, rather than keeping it: what you kept
doesn't follow the remote to a resizable attached later.

**Reading it in React.** `useResizableRemote(remote, select, equals?)` gives
what `select` picks from the view, and re-renders only when that changes (by
`Object.is`, or `equals` if given). `select` gets `null` while nothing is
attached, on the server and while hydrating, so it says what to show then. It
runs on every change, a drag's frames included, so keep it cheap; and if it
builds an array or an object, give an `equals`, or every frame is a change. A
layout's view has every child by id in `children` (elements, nested groups and
grids, and tracks), which the hook itself doesn't return:

```tsx
import {
  type UseResizableLayoutOptions,
  createLayoutRemote,
  useResizableRemote,
} from "@kellanjs/use-resizable";

const PANELS = ["main", "notes"] as const;

export const workspaceLayout = {
  id: "workspace",
  direction: "row",
  children: [
    { id: "main", stops: { closed: 0, open: { min: 320 } } },
    { id: "notes", stops: { closed: 0, open: { min: 240 } } },
  ],
} as const satisfies UseResizableLayoutOptions["layout"];

// Given to the layout: useResizableLayout({ layout: workspaceLayout, remote: workspaceRemote }).
export const workspaceRemote = createLayoutRemote<typeof workspaceLayout>();

export function OpenPanels() {
  const openIds = useResizableRemote(
    workspaceRemote,
    (view) =>
      view
        ? PANELS.filter((id) => view.children[id].stop !== "closed")
        : ["main"],
    (a, b) => a.join() === b.join(),
  );
  return <output>{openIds.join(", ")}</output>;
}

// The last open panel stays open.
export function togglePanel(id: (typeof PANELS)[number]) {
  if (workspaceRemote.current?.canToggle(id, "closed")) {
    workspaceRemote.current.toggle(id, "closed");
  }
}
```

**Types.** The type argument gives the remote its stop names (and a layout's
ids): `createResizableRemote<typeof options>()` takes the hook's options' type,
`createLayoutRemote<typeof layout>()` the `layout` option's (with `as const`,
for its ids). So `sidebarRemote.current?.toggle("tiny")` is a type error and
`view.width.stop` is `"closed" | "open" | null`. Only the part of the options
with the stops needs to be where the remote is made; the rest (a `persist` key
from props, callbacks, sizes) can differ where the hook is called. A remote for
other stops, other dimensions or another anchoring is a type error on the
`remote` option. To name a remote's type, use
`ResizableRemoteOf<typeof sidebarOptions>` or
`LayoutRemoteOf<typeof workspaceLayout>`.

**One at a time.** A remote stands for one mounted resizable. Made at module
level, as above, it suits one the app has once, like its sidebar. For one that's
rendered several times (each document's editor split), make a remote for each
where it's created (`useState(() => createLayoutRemote<Layout>())`) and pass it
down, or pass the hook's result itself (see [Types](#types)), which is simpler
when the controls are inside it. A remote given to a second mounted resizable
while the first still has it moves to the newer one, with a warning in
development, and doesn't go back when that one unmounts.

**Server rendering.** Readers get `null` on the server and while hydrating, so
they can't show the resizable's stop until it's mounted: `select` says what to
show until then. The resizable itself can render its saved size on the server
(see [Server rendering without a flash](#server-rendering-without-a-flash)).

### Types

Each hook types what it returns from its options. In `useResizable`, a dimension
the options configure is always there (`sidebar.width`, no `?.`), and its stops
are named (`sidebar.width.stop` is `"rail" | "open" | null`, and
`setStop("tiny")` is a type error); a floating element's `position` needs no
`?.` either. In `useResizableLayout`, ids are the layout's (`getChild("files")`
needs no `?.`), each child with its own stop names, children made from a list of
ids (`ids.map((id) => ({ id, stops }))`, with `as const`) included.

Some children may not be there, so `getChild` for them needs a `?.`:

- children in an array made with `map` or `filter`, which TypeScript can't tell
  apart (written out as a tuple, they're always there);
- a child only some of the layouts the options can be have
  (`small ? compact : full`, at any depth);
- a child whose id is a union (`{ id: selected }`);
- with ids built at runtime (`` `pane-${n}` ``), every id is `string`, and
  `getChild` may return `undefined`.

On the render that adds a child, before the layout has taken it in, it reads as
not measured yet (`size`, `stop` and `stops` `null`).

**Passing it to another component.** Typed as the plain `Resizable` or
`ResizableLayout`, a component takes any resizable, but without those details: a
dimension may be `null`, and a stop is any `string`. That suits components that
work with any of them, such as a set of handles or a size readout.
(`ResizableLayout<"files" | "editor">` checks the ids it's given, though not
stop names.)

```tsx
import type { Resizable } from "@kellanjs/use-resizable";

export function SizeReadout({ resizable }: { resizable: Resizable }) {
  return <output>{Math.round(resizable.width?.size ?? 0)}px</output>;
}
```

For a component that belongs to one resizable, keep its types: put the hook call
in a hook of your own, and use what that returns. This works whatever the
options depend on (props, state).

```tsx
import { useResizable } from "@kellanjs/use-resizable";

function useSidebar() {
  return useResizable({
    anchor: "start",
    width: { defaultSize: 240, stops: { rail: 48, open: { min: 200 } } },
  });
}
type Sidebar = ReturnType<typeof useSidebar>;

export function SidebarToggle({ sidebar }: { sidebar: Sidebar }) {
  return (
    <button onClick={() => sidebar.toggle("rail")}>
      {sidebar.width.stop === "rail" ? "Expand" : "Collapse"}
    </button>
  );
}
```

Or, with options that don't change, name their type: `ResizableOf` for
`useResizable`, `ResizableLayoutOf` for a layout. A layout's options need
`as const`, or their ids widen to `string`. `satisfies` checks them where
they're written rather than where they're used.

```tsx
import {
  type ResizableLayoutOf,
  type UseResizableLayoutOptions,
  useResizableLayout,
} from "@kellanjs/use-resizable";

const ideOptions = {
  layout: {
    id: "ide",
    direction: "row",
    children: [
      { id: "files", stops: { rail: 48, open: { min: 180 } } },
      { id: "editor" },
    ],
  },
} as const satisfies UseResizableLayoutOptions;

export type Ide = ResizableLayoutOf<typeof ideOptions>;

export function useIde(): Ide {
  return useResizableLayout(ideOptions);
}
```

Either way, it's still a `Resizable` or `ResizableLayout`, so it can also be
passed to the components that take any.

### Without React

The hooks are thin wrappers over framework-free controllers, which you can use
directly (or in another framework):

```ts
import { createResizableController } from "@kellanjs/use-resizable";

declare const element: HTMLElement;
declare const handle: HTMLElement;
declare function render(view: unknown): void;

const controller = createResizableController({
  anchor: "left",
  width: { defaultSize: 240, minSize: 160 },
});
controller.elementRef(element);
controller.handleRef("right")(handle);
const unmount = controller.mount();

controller.subscribe(() => render(controller.getView()));
```

`createResizableController(options)` takes `useResizable`'s options, with
`getContainer: () => Element | null` instead of `containerRef` (and no `id`,
`valueText` or `remote`, which are the hook's).
`createLayoutController(options)` takes `useResizableLayout`'s (without
`idPrefix`, `valueText` or `remote`).

| Controller member                                                                                                        | What it does                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `getView()`                                                                                                              | What it is now: what the hook returns, without the props and methods. The same object until something changes. |
| `subscribe(listener)`                                                                                                    | Calls `listener` after every change; returns an unsubscribe function.                                          |
| `setOptions(options)`                                                                                                    | Applies new options; cheap to call often.                                                                      |
| `mount()`                                                                                                                | Starts measuring and loads what's saved; returns its own cleanup.                                              |
| `elementRef`, `handleRef(edge)`, `moveHandleRef`, `clipRef`                                                              | `useResizable`'s ref callbacks: attach an element, or `null` to detach.                                        |
| `elementRef(id)`, `groupRef(id)`, `clipRef(id)`, `separatorRef(before, after, primary?, segment?)`, `junctionRef(pairs)` | A layout's ref callbacks (`pairs`: `{ before, after }[]`).                                                     |
| `setStop`, `toggle`, `setSize`, `reset`, `getSnapshot`, `restore`                                                        | As the hook's (and `setPosition`; a layout's `setStops`, `canSetStop`, `canToggle`, `canSetStops`).            |

A `useResizable` view has `width` and `height` (size, stop, stops in pixels,
content size…), `position`, `dragging`, `animating` and `handles`. A layout's
has `elements`, every child by id in `children` (elements, nested groups and
grids, and tracks; not cells), `dragging`, `animating` and `overflowing`. Refs
are callbacks that return their own cleanup.

What the hooks add on top, the styles and ARIA attributes in their props, isn't
exported yet: outside React, you apply the sizes yourself.

### Exports

- **Hooks:** `useResizable`, `useResizableLayout`, `useResizableRemote`,
  `useMergedRefs`.
- **Functions:** `createResizableRemote`, `createLayoutRemote`,
  `createResizableController`, `createLayoutController`, `isResizableSnapshot`,
  `isLayoutSnapshot`, `mergeRefs`.
- **Options types:** `UseResizableOptions`, `UseResizableLayoutOptions`,
  `DimensionOptions`, `TrackOptions`, `StopValue`, `PointStopOptions`,
  `RangeStopOptions`, `StopElastic`, `LayoutOptions`, `LayoutRootOptions`,
  `LayoutGroupOptions`, `LayoutNestedGroupOptions`, `LayoutGridOptions`,
  `LayoutChildOptions`, `LayoutElementOptions`, `LayoutTrackOptions`,
  `LayoutCellOptions`, `LayoutFill`, `LayoutDirection`, `PersistOptions`,
  `SnapshotStorage`, `TransitionOptions`, `TransitionTiming`, `ChangeKind`,
  `KeyboardOptions`, `ElasticOptions`, `Reflow`, `PropsOptions`, `ClipOptions`,
  `LayoutClipOptions`, `SeparatorPropsOptions`, `ResizableControllerOptions`,
  `LayoutControllerOptions`.
- **Value types:** `SizeValue`, `SizeBound`, `Anchor`, `Edge`, `Corner`,
  `HandleEdge`, `InlineEdge`, `LogicalCorner`, `LogicalHandleEdge`, `Dimension`,
  `DragTarget`, `CornerDrag`, `SeparatorPair`, `SeparatorSide`, `ResolvedStop`,
  `ChangeCause`, `CommittedChange`, `ResizableSnapshot`, `LayoutSnapshot`.
- **Return types:** `Resizable`, `ResizableOf`, `ResizableView`,
  `ResizableViewOf`, `ResizableDimension`, `ResizableLayout`,
  `ResizableLayoutOf`, `ResizableLayoutView`, `ResizableLayoutViewOf`,
  `ResizableLayoutChild`, `ResizableLayoutEntry`,
  `ResizableLayoutSeparatorEntry`, `ResizableController`, `LayoutController`,
  and the props: `ResizableElementProps`, `ResizableHandleProps`,
  `ResizableMoveHandleProps`, `ResizableContentProps`, `ResizableClipProps`,
  `ResizableLayoutElementProps`, `ResizableLayoutGroupProps`,
  `ResizableLayoutSeparatorProps`, `ResizableLayoutJunctionProps`.
- **Remote types:** `ResizableRemote`, `ResizableRemoteOf`,
  `ResizableRemoteEndpoint`, `LayoutRemote`, `LayoutRemoteOf`,
  `LayoutRemoteEndpoint`, `ReadableRemote`.

## Pitfalls

- **Clipped handles.** Handles usually hang half outside the element. An element
  with `overflow: hidden` clips them, leaving a sliver to grab. Put
  `overflow: hidden` on an inner wrapper instead. (Layout elements already clip
  their content; groups deliberately don't, so separators near their edges stay
  grabbable.)
- **Controls inside the content wrapper or the clip layer.** Handles, separators
  and junctions go beside `getContentProps`' wrapper, not in it: it's laid out
  at the content size, and while its size is fixed it's what they'd be
  positioned against, so they'd stop following their edges. And beside
  `getClipProps`' layer, which clips what hangs over the edge.
- **A clip layer needs its element to be positioned.** It fills what it's
  positioned against, so give the element `position: relative` (or another way
  of being a containing block), and a size that doesn't come from its content,
  which the layer takes out of its flow.
- **The anchor must match the CSS.** See [Anchors and
  handles](#anchors-and-handles).
- **Floating elements need a positioned container.** With `anchor: "none"`, the
  element gets `position: absolute` and `left`/`top`, so its container needs
  `position: relative` (or another positioning).
- **`%` heights need a sized container.** A `%` height resolves against the
  container's height, so avoid it when that height depends on the content (the
  same circularity as in CSS).
- **Padding on a child that closes.** Nothing renders smaller than its own
  padding and border, so a layout child that goes to zero (or to a rail narrower
  than its padding) should pad an inner wrapper instead.
- **`priority` alone doesn't close panes first.** Every child shrinks to its
  minimum before any steps down; to keep a pane's size while others close, use
  `keepSize: "yield-first"` (see [rule 4](#4-stepping-down-to-fit)).
- **Don't read storage during render.** Use `persist`, or `restore()` in an
  effect. Reading it while rendering makes the client disagree with the server's
  HTML.

### Development warnings

Mistakes that would otherwise fail silently are warned about once each, in
development; production builds stay quiet:

- an id that isn't in the options (it renders at 0px);
- `getElementProps` on a group, or `getGroupProps` on an element; `childrenOf`
  or `separatorsOf` on something that isn't a group (or grid); `getContentProps`
  or `getClipProps` on something that isn't an element;
- a separator between two children that aren't neighbours; a junction of fewer
  than two separators, or of separators that would fight (they move the same
  space); a separator pressed inside a junction's box (something covers the
  junction);
- a `defaultSize` outside every stop with no `defaultStop` (it would show, then
  jump once measured);
- a `setStop`, `toggle`, `setStops` or `setSize` that would leave a group with
  nothing to take its space, or would overflow a group with `refuseOverflow`
  (refused);
- a handle the resizable doesn't offer (it gets no tab stop or cursor, and does
  nothing); a handle or separator without an `aria-label`; an absolutely
  positioned handle with nothing positioned to sit against;
- a handle, separator or junction inside a content wrapper or a clip layer; a
  clip layer that doesn't fill its element; `slide` on a grid's cell or a
  floating element (they cover);
- `reflow: "once"` with no content wrapper to keep at a fixed size;
- `persist.sync` with a storage that can't be followed;
- a `remote` option that isn't a remote, a remote of the other kind (a layout's
  to `useResizable`), and a remote given to a second mounted resizable while the
  first still has it.

Options that can't work throw instead, from either hook: a missing `width` and
`height`, `stops` with `minSize` or `maxSize`, an unknown stop name (in
`defaultStop`, `enterToggles` or `yieldTo`), `yieldTo` steps that come back
round, two parts of a layout with the same id, size options on a `fill`, cells
that overlap or span past the grid, `defaultPosition` or `confine` without
`anchor: "none"`, a handle the anchor doesn't allow, and malformed sizes.
