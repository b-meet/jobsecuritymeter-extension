import { BASE_CSS, BOLT_SVG, CHEVRON_SVG, COLORS, TOP_LAYER } from "./theme";
import { throttled } from "./raf";
import {
  loadDock,
  placementFor,
  saveDock,
  snap,
  toPixels,
  type DockPosition,
  type Placement,
} from "./dock";

/**
 * The persistent on-page handle, and the card it opens.
 *
 * This is the surface that replaces "remember the extension exists, find it in
 * the toolbar, click it". It mounts itself when we detect a real application
 * form and opens once, unprompted; after that it is a small draggable handle
 * parked on whichever edge the user left it on.
 *
 * IT NEVER FILLS ANYTHING ON ITS OWN. Every state here ends in the user
 * pressing a button. Silently writing values into a job application is the
 * failure this codebase is built to avoid - see content/detect.ts - and
 * auto-acting extensions are also what store review is looking for.
 */

export type PanelState =
  | { kind: "ready"; count: number; connected: boolean }
  | { kind: "filling" }
  | { kind: "report"; filled: number; skipped: number }
  | { kind: "error"; message: string };

export type PanelHandlers = {
  onFill: () => void;
  onConnect: () => void;
  onEditProfile: () => void;
  /** Told when the handle is tucked away or pulled back, so it can be remembered. */
  onTuckedChange: (tucked: boolean) => void;
  /**
   * The element the handle pins itself to when this frame cannot pin to the
   * viewport. See `placementFor` in dock.ts for when that happens.
   */
  anchor: () => Element | null;
};

export type Panel = {
  setState(state: PanelState): void;
  /** Opens the card, but only the first time - see `autoOpened`. */
  openOnce(): void;
  /** Collapse to the edge tab, or pull back out. */
  setTucked(tucked: boolean): void;
  reposition(): void;
  destroy(): void;
};

const CARD_WIDTH = 268;
const HANDLE_SIZE = 40;
/** Pointer travel that turns a click into a drag. */
const DRAG_THRESHOLD = 4;

const CSS = `
  ${BASE_CSS}

  .root {
    position: absolute;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    pointer-events: none;
  }
  .root[data-edge="left"] { flex-direction: row-reverse; }

  .handle {
    flex: 0 0 auto;
    width: ${HANDLE_SIZE}px; height: ${HANDLE_SIZE}px;
    border-radius: 50%;
    background: ${COLORS.green};
    color: #fff;
    display: grid; place-items: center;
    box-shadow: 0 6px 20px rgba(0,0,0,.24);
    pointer-events: auto;
    touch-action: none;
    transition: transform .16s ease, box-shadow .16s ease;
  }
  .handle:hover { transform: scale(1.06); }
  .handle:active { cursor: grabbing; }
  .handle:focus-visible { outline: 3px solid ${COLORS.amber}; outline-offset: 2px; }
  .handle svg { width: 20px; height: 20px; display: block; }
  .handle[data-busy="true"] svg { animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .35; } }

  .badge {
    position: absolute; top: -4px; right: -4px;
    min-width: 18px; height: 18px; padding: 0 5px;
    border-radius: 9px;
    background: ${COLORS.amber}; color: ${COLORS.greenDeep};
    font-size: 11px; font-weight: 700; line-height: 18px; text-align: center;
    box-shadow: 0 0 0 2px ${COLORS.green};
  }
  .handle-wrap { position: relative; flex: 0 0 auto; }

  /**
   * The tucked state: a sliver against the window edge.
   *
   * Kept deliberately small and low-contrast. This is what someone chose when
   * they said "not here" - it has to be findable without being something they
   * have to look at while filling in a form.
   */
  .tab {
    display: none;
    align-items: center; justify-content: center;
    width: 15px; height: 46px;
    background: ${COLORS.green};
    color: #fff;
    opacity: .45;
    pointer-events: auto;
    touch-action: none;
    transition: opacity .16s ease, width .16s ease;
  }
  .tab:hover, .tab:focus-visible { opacity: 1; width: 19px; }
  .tab:focus-visible { outline: 2px solid ${COLORS.amber}; outline-offset: 2px; }
  .tab svg { width: 11px; height: 11px; display: block; }

  .root[data-tucked="true"] .tab { display: flex; }
  .root[data-tucked="true"] .handle-wrap,
  .root[data-tucked="true"] .card { display: none; }

  /* Flush to the edge it is parked on, rounded only on the inward side. */
  .root[data-edge="right"] .tab { border-radius: 8px 0 0 8px; }
  .root[data-edge="left"] .tab { border-radius: 0 8px 8px 0; }
  .root[data-edge="left"] .tab svg { transform: rotate(180deg); }

  .card {
    width: ${CARD_WIDTH}px;
    background: ${COLORS.cream};
    border-radius: 14px;
    padding: 14px;
    box-shadow: 0 14px 40px rgba(0,0,0,.22);
    pointer-events: auto;
  }
  .card[hidden] { display: none; }

  .title { font-size: 13px; font-weight: 700; letter-spacing: -.01em; }
  .body { font-size: 12px; color: ${COLORS.muted}; margin-top: 3px; }

  .primary {
    display: block; width: 100%; margin-top: 11px;
    padding: 9px 12px; border-radius: 10px;
    background: ${COLORS.green}; color: #fff;
    font-size: 13px; font-weight: 700; text-align: center;
  }
  .primary:disabled { opacity: .55; cursor: default; }
  .primary:focus-visible { outline: 3px solid ${COLORS.amber}; outline-offset: 2px; }

  .foot {
    display: flex; gap: 10px; align-items: center;
    margin-top: 10px; padding-top: 9px;
    border-top: 1px solid ${COLORS.line};
  }
  .link { font-size: 11px; font-weight: 600; color: ${COLORS.muted}; }
  .link:hover { color: ${COLORS.ink}; text-decoration: underline; }
  .link:focus-visible { outline: 2px solid ${COLORS.amber}; outline-offset: 2px; }
  .spacer { flex: 1; }
`;

export function mountPanel(handlers: PanelHandlers): Panel {
  const placement: Placement = placementFor();

  const host = document.createElement("div");
  // Sits at the document origin and holds nothing itself; the wrapper inside
  // does the positioning. `pointer-events: none` here is what keeps a 0x0
  // container from ever swallowing a click meant for the form.
  host.style.cssText = `position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:${TOP_LAYER};`;
  const shadow = host.attachShadow({ mode: "closed" });

  shadow.innerHTML = `
    <style>${CSS}</style>
    <div class="root" part="root">
      <div class="card" hidden role="dialog" aria-label="Job Autofill"></div>
      <div class="handle-wrap">
        <button class="handle" type="button" aria-label="Job Autofill" aria-expanded="false">
          ${BOLT_SVG}
        </button>
        <span class="badge" hidden></span>
      </div>
      <button class="tab" type="button" aria-label="Show Job Autofill">${CHEVRON_SVG}</button>
    </div>
  `;

  (document.body ?? document.documentElement).appendChild(host);

  const root = shadow.querySelector(".root") as HTMLElement;
  const card = shadow.querySelector(".card") as HTMLElement;
  const handle = shadow.querySelector(".handle") as HTMLButtonElement;
  const badge = shadow.querySelector(".badge") as HTMLElement;
  const tab = shadow.querySelector(".tab") as HTMLButtonElement;

  let dock: DockPosition = { edge: "right", offset: 0.4 };
  let state: PanelState = { kind: "ready", count: 0, connected: false };
  let open = false;
  let autoOpened = false;
  let tucked = false;
  let destroyed = false;

  /**
   * The host's real position in page coordinates.
   *
   * A page whose `<body>` is positioned or has a margin shifts the containing
   * block out from under us, so absolute coordinates computed straight from
   * `getBoundingClientRect()` would land offset by that much. Measuring the
   * host itself corrects for it exactly, whatever the page has done.
   */
  function origin(): { x: number; y: number } {
    const rect = host.getBoundingClientRect();
    return { x: rect.left + window.scrollX, y: rect.top + window.scrollY };
  }

  function applyFixed(): void {
    const { top, left, right } = toPixels(dock, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    root.style.position = "fixed";
    root.style.top = `${top}px`;
    // Tucked, it sits flush against the edge rather than inset by the usual
    // margin - a tab floating 16px off the side reads as a stray element.
    const margin = tucked ? 0 : null;
    root.style.left = left === null ? "auto" : `${margin ?? left}px`;
    root.style.right = right === null ? "auto" : `${margin ?? right}px`;
    root.dataset.edge = dock.edge;
  }

  /**
   * Pin to the form instead of the viewport.
   *
   * Used only in an embedded board that does its own scrolling through the
   * parent page, where nothing inside the frame can stay fixed to the screen.
   * The handle sits at the form's top-right and scrolls with it - visible when
   * the user arrives at the form, which is the moment that matters.
   */
  function applyAnchored(): void {
    const target = handlers.anchor();
    const base = origin();

    root.style.position = "absolute";
    root.dataset.edge = "right";

    if (!target) {
      root.style.top = "16px";
      root.style.left = `${Math.max(16, window.innerWidth - CARD_WIDTH - HANDLE_SIZE - 32)}px`;
      root.style.right = "auto";
      return;
    }

    const rect = target.getBoundingClientRect();
    const pageTop = rect.top + window.scrollY - base.y;
    const pageRight = rect.right + window.scrollX - base.x;

    root.style.top = `${Math.max(8, pageTop - 8)}px`;
    root.style.left = `${Math.max(8, pageRight - HANDLE_SIZE)}px`;
    root.style.right = "auto";
  }

  function reposition(): void {
    if (destroyed) return;
    if (placement === "fixed") applyFixed();
    else applyAnchored();
  }

  /* ------------------------------------------------------------- rendering */

  function render(): void {
    root.dataset.tucked = String(tucked);
    handle.dataset.busy = String(state.kind === "filling");

    const showBadge = state.kind === "ready" && state.connected && state.count > 0;
    badge.hidden = !showBadge;
    if (showBadge && state.kind === "ready") badge.textContent = String(state.count);

    card.hidden = !open;
    handle.setAttribute("aria-expanded", String(open));
    if (!open) return;

    card.replaceChildren(...cardContent());
  }

  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    // textContent throughout: labels and counts are the only dynamic values
    // here, and a field label is PAGE-CONTROLLED text. innerHTML with it would
    // be an injection straight into our own privileged overlay.
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function cardContent(): HTMLElement[] {
    const nodes: HTMLElement[] = [];

    if (state.kind === "error") {
      nodes.push(el("div", "title", "Job Autofill"), el("p", "body", state.message));
      nodes.push(button("primary", "Try again", handlers.onFill));
      nodes.push(footer());
      return nodes;
    }

    if (state.kind === "filling") {
      nodes.push(el("div", "title", "Filling…"), el("p", "body", "One moment."));
      const busy = button("primary", "Filling…", () => {});
      (busy as HTMLButtonElement).disabled = true;
      nodes.push(busy);
      return nodes;
    }

    if (state.kind === "report") {
      const { filled, skipped } = state;
      nodes.push(
        el("div", "title", filled ? `Filled ${plural(filled, "field")}` : "Nothing matched"),
        el(
          "p",
          "body",
          filled
            ? skipped
              ? `${plural(skipped, "field")} left for you — check the form before submitting.`
              : "Check the form before submitting."
            : "Nothing on this form matched your saved profile.",
        ),
      );
      nodes.push(button("primary", "Done", close));
      nodes.push(footer());
      return nodes;
    }

    if (!state.connected) {
      nodes.push(
        el("div", "title", "Job Autofill"),
        el("p", "body", "Connect your account to fill this application from your profile."),
        button("primary", "Connect account", handlers.onConnect),
        footer(),
      );
      return nodes;
    }

    nodes.push(
      el("div", "title", "Ready to fill"),
      el("p", "body", `${plural(state.count, "field")} on this form match your saved profile.`),
      button("primary", `Fill ${plural(state.count, "field")}`, handlers.onFill),
      footer(),
    );
    return nodes;
  }

  function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
    const node = el("button", className, label);
    node.type = "button";
    node.addEventListener("click", onClick);
    return node;
  }

  function footer(): HTMLElement {
    const foot = el("div", "foot");
    foot.append(
      // Says where it goes, not that it goes away. "Not on this site" promised
      // more than it should have delivered and left no way back.
      button("link", "Hide on this site", () => applyTucked(true)),
      el("span", "spacer"),
      button("link", "Edit profile", handlers.onEditProfile),
    );
    return foot;
  }

  function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`;
  }

  /* ---------------------------------------------------------- open / close */

  function setOpen(next: boolean): void {
    open = next;
    render();
  }

  function close(): void {
    setOpen(false);
  }

  /**
   * Collapse to the edge tab, or pull back out.
   *
   * Tucking closes the card too - leaving it open behind a hidden handle would
   * be the same disappearing act in a different costume.
   */
  function applyTucked(next: boolean): void {
    if (tucked === next) return;
    tucked = next;
    if (tucked) open = false;
    reposition();
    render();
    handlers.onTuckedChange(tucked);
  }

  function onDocumentPointerDown(event: Event): void {
    // `composedPath` is what makes this work through the shadow boundary - the
    // event's `target` outside the root is always the host element.
    if (!open) return;
    if (event.composedPath().includes(host)) return;
    close();
  }

  function onKeyDown(event: KeyboardEvent): void {
    // Never swallow the key: some ATS forms use Escape to close their own
    // dialogs, and eating it would break the page around us.
    if (event.key === "Escape" && open) close();
  }

  /* ------------------------------------------------------------------ drag */

  let dragging = false;
  let moved = false;
  let start = { x: 0, y: 0 };

  /**
   * Drag is offered only where there is somewhere to drag TO.
   *
   * In an anchored frame the handle belongs to the form, not the window, so
   * "park it on the left edge" has no meaning - there is no window edge the
   * frame can address.
   */
  const draggable = placement === "fixed";

  /**
   * Make a grip both draggable and clickable.
   *
   * Bound to the handle and to the tucked tab alike, so pulling the tab back
   * out is the same gesture as moving the handle - drag it off the edge, or
   * just click it. `activate` is what a press that never became a drag means.
   */
  function bindGrip(grip: HTMLElement, activate: () => void): void {
    grip.addEventListener("pointerdown", (event: PointerEvent) => {
      if (!draggable || event.button !== 0) return;
      dragging = true;
      moved = false;
      start = { x: event.clientX, y: event.clientY };
      grip.setPointerCapture(event.pointerId);
    });

    grip.addEventListener("pointermove", (event: PointerEvent) => {
      if (!dragging) return;

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      if (!moved) {
        moved = true;
        // Dragging the tab is how you pull it back out - by the time it is
        // following the cursor it is a handle again, not a sliver.
        if (tucked) applyTucked(false);
        // Close while dragging: a 268px card whipping around the screen
        // attached to the cursor would cover the form being dragged over.
        if (open) setOpen(false);
      }

      root.style.position = "fixed";
      root.style.left = `${event.clientX - HANDLE_SIZE / 2}px`;
      root.style.top = `${event.clientY - HANDLE_SIZE / 2}px`;
      root.style.right = "auto";
    });

    function endDrag(event: PointerEvent): void {
      if (!dragging) return;
      dragging = false;
      if (grip.hasPointerCapture(event.pointerId)) grip.releasePointerCapture(event.pointerId);

      if (!moved) {
        activate();
        return;
      }

      dock = snap(
        { x: event.clientX, y: event.clientY },
        { width: window.innerWidth, height: window.innerHeight },
      );
      reposition();
      void saveDock(dock);
    }

    grip.addEventListener("pointerup", endDrag);
    grip.addEventListener("pointercancel", endDrag);

    // Keyboard and non-draggable frames never see a pointer drag, so the plain
    // click path has to act too. `moved` guards the double-fire after a drag.
    grip.addEventListener("click", (event) => {
      event.preventDefault();
      if (moved || draggable) return;
      activate();
    });
    grip.addEventListener("keydown", (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activate();
    });
  }

  bindGrip(handle, () => setOpen(!open));
  bindGrip(tab, () => applyTucked(false));

  /* ---------------------------------------------------------------- wiring */

  const onViewportChange = throttled(reposition);
  window.addEventListener("resize", onViewportChange, { passive: true });
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onKeyDown, true);

  void loadDock().then((stored) => {
    if (destroyed) return;
    dock = stored;
    reposition();
  });

  reposition();
  render();

  return {
    setState(next: PanelState): void {
      state = next;
      render();
      // A report can change the anchor's height (validation messages appear),
      // so re-measure rather than trusting the position from mount time.
      if (placement === "anchored") reposition();
    },

    openOnce(): void {
      if (autoOpened) return;
      autoOpened = true;
      // Tucked is a standing instruction, not a per-page one. Popping the card
      // open anyway would undo the thing the user asked for.
      if (tucked) return;
      setOpen(true);
    },

    setTucked: applyTucked,

    reposition,

    destroy(): void {
      destroyed = true;
      window.removeEventListener("resize", onViewportChange);
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      host.remove();
    },
  };
}
