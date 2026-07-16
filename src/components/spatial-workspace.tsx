"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowLeftRight, ArrowUp, Check, ChevronLeft, CloudOff, GripVertical, PanelTop, RotateCcw, Settings2, X } from "lucide-react";
import styles from "./spatial-workspace.module.css";

type Point = { x: number; y: number };
type View = Point & { zoom: number };
type Rail = "left" | "right";

export type SpatialCameraState = {
  level: "overview" | "item" | "nested" | "free";
  id?: string;
  parentId?: string;
  label?: string;
};

export type SpatialWorkspaceItem = {
  id: string;
  label: string;
  title: string;
  x: number;
  y: number;
  width: number;
  focusZoom?: number;
  minFocusZoom?: number;
  className?: string;
  hideLandmark?: boolean;
  movable?: boolean;
  persistPosition?: boolean;
  parentId?: string;
  children: React.ReactNode;
};

export type SpatialLayoutPersistence = {
  familyId: string;
  surface: "day" | "week";
  scopeKey: string;
  layoutVersion: 2;
  positions?: Record<string, Point>;
};

export type WorkspaceRailLayout = Record<Rail, string[]>;

type SpatialWorkspaceProps = {
  ariaLabel: string;
  persistenceKey: string;
  items: SpatialWorkspaceItem[];
  initialView: View;
  overviewView: View;
  homeItemId?: string;
  focusRequest?: { id: string; key: number } | null;
  layoutPersistence?: SpatialLayoutPersistence;
  onCameraChange?: (state: SpatialCameraState) => void;
  toolbar: React.ReactNode;
  assistant: React.ReactNode;
};

const LAYOUT_VERSION = 2;
const LEFT_POSITION = 0;
const RIGHT_POSITION = 3200;

export function SpatialWorkspace({ ariaLabel, persistenceKey, items, homeItemId = "schedule", focusRequest, layoutPersistence, onCameraChange, toolbar, assistant }: SpatialWorkspaceProps) {
  const persistedPositions = layoutPersistence?.layoutVersion === LAYOUT_VERSION ? layoutPersistence.positions : undefined;
  const initialLayout = () => workspaceRailLayout(items, homeItemId, persistedPositions);
  const [layout, setLayout] = useState<WorkspaceRailLayout>(initialLayout);
  const [activePanelId, setActivePanelId] = useState<string | null>(null);
  const [arranging, setArranging] = useState(false);
  const [layoutStatus, setLayoutStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [camera, setCamera] = useState<SpatialCameraState>({ level: "item", id: homeItemId, label: items.find((item) => item.id === homeItemId)?.label });
  const draggedIdRef = useRef<string | null>(null);
  const layoutRef = useRef(layout);
  const cameraRef = useRef(camera);
  const railItemIds = items.filter((item) => item.id !== homeItemId && !item.hideLandmark).map((item) => item.id).join("|");
  const schedule = items.find((item) => item.id === homeItemId) ?? items[0];
  const activePanel = activePanelId ? items.find((item) => item.id === activePanelId) : undefined;
  const panelSide = activePanel ? findRail(layout, activePanel.id) ?? "right" : null;
  const updateCount = layout.left.length + layout.right.length;

  const visibleItems = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  function updateCamera(next: SpatialCameraState) {
    cameraRef.current = next;
    setCamera(next);
    onCameraChange?.(next);
  }

  function showSchedule() {
    setActivePanelId(null);
    updateCamera({ level: "item", id: homeItemId, label: schedule?.label ?? "Schedule" });
  }

  function showPanel(id: string) {
    const item = visibleItems.get(id);
    if (!item || id === homeItemId) return showSchedule();
    setActivePanelId(id);
    updateCamera({ level: "item", id, parentId: item.parentId, label: item.label });
  }

  function closePanel() {
    showSchedule();
  }

  function commitLayout(next: WorkspaceRailLayout) {
    layoutRef.current = next;
    setLayout(next);
    void persistLayout(next);
  }

  function moveTab(id: string, side: Rail, index: number) {
    const next = moveWorkspaceTab(layoutRef.current, id, side, index);
    commitLayout(next);
  }

  function nudgeTab(id: string, direction: -1 | 1) {
    const side = findRail(layoutRef.current, id);
    if (!side) return;
    const index = layoutRef.current[side].indexOf(id);
    moveTab(id, side, index + direction);
  }

  function switchTabSide(id: string) {
    const side = findRail(layoutRef.current, id);
    if (!side) return;
    const destination = side === "left" ? "right" : "left";
    moveTab(id, destination, layoutRef.current[destination].length);
  }

  function resetLayout() {
    const next = workspaceRailLayout(items, homeItemId);
    setActivePanelId(null);
    setArranging(false);
    commitLayout(next);
  }

  async function persistLayout(next: WorkspaceRailLayout) {
    const positions = workspaceRailPositions(items, homeItemId, next);
    try {
      window.localStorage.setItem(`klio-spatial:${persistenceKey}`, JSON.stringify({ layoutVersion: LAYOUT_VERSION, positions }));
    } catch {
      // Family-scoped server sync remains available when browser storage is unavailable.
    }
    if (!layoutPersistence) return;
    setLayoutStatus("saving");
    try {
      const response = await fetch("/api/workspace-layout", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...layoutPersistence, positions }),
      });
      setLayoutStatus(response.ok ? "saved" : "error");
    } catch {
      setLayoutStatus("error");
    }
  }

  useEffect(() => {
    let cancelled = false;
    let positions = persistedPositions;
    if (!positions || !Object.keys(positions).length) {
      try {
        const saved = window.localStorage.getItem(`klio-spatial:${persistenceKey}`);
        const parsed = saved ? JSON.parse(saved) as { layoutVersion?: number; positions?: Record<string, Point> } : null;
        if (parsed?.layoutVersion === LAYOUT_VERSION) positions = parsed.positions;
      } catch {
        // A damaged local preference should never hide the family schedule.
      }
    }
    const next = workspaceRailLayout(items, homeItemId, positions);
    layoutRef.current = next;
    queueMicrotask(() => {
      if (cancelled) return;
      setLayout(next);
      setActivePanelId(null);
      setArranging(false);
      updateCamera({ level: "item", id: homeItemId, label: schedule?.label ?? "Schedule" });
    });
    return () => { cancelled = true; };
    // Defaults are recalculated only when the workspace identity or available areas change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistenceKey, railItemIds]);

  useEffect(() => {
    const requestedId = focusRequest?.id;
    if (!requestedId) return;
    const firstFrame = window.requestAnimationFrame(() => showPanel(requestedId));
    return () => window.cancelAnimationFrame(firstFrame);
    // The request key intentionally retriggers focus for the same lesson.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.id, focusRequest?.key]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (activePanelId) closePanel();
      else if (cameraRef.current.level === "nested") showSchedule();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePanelId]);

  function onWorkspaceClick(event: React.MouseEvent<HTMLDivElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-spatial-focus-target]");
    if (!target || activePanelId) return;
    updateCamera({ level: "nested", id: target.dataset.spatialFocusId, parentId: homeItemId, label: target.dataset.spatialFocusLabel ?? "Lesson" });
  }

  if (!schedule) return null;

  return (
    <div
      className={`${styles.viewport} spatial-workspace`}
      aria-label={ariaLabel}
      data-camera-level={camera.level}
      data-camera-id={camera.id ?? ""}
      data-zoom="working"
      onClickCapture={onWorkspaceClick}
    >
      <div className={styles.toolbar}>{toolbar}</div>

      <div className={`${styles.board} ${updateCount === 0 ? styles.boardQuiet : ""}`}>
        {layout.left.length ? <WorkspaceRail side="left" ids={layout.left} items={visibleItems} activePanelId={activePanelId} arranging={arranging} draggedIdRef={draggedIdRef} onOpen={showPanel} onMove={moveTab} onNudge={nudgeTab} onSwitchSide={switchTabSide} /> : null}

        <main className={styles.scheduleStage} aria-label={`${schedule.label}: ${schedule.title}`} data-spatial-id={schedule.id} data-spatial-object>
          <header className={styles.scheduleHeader}>
            <div><span>{schedule.label}</span><strong>{schedule.title}</strong></div>
            {activePanel ? <button type="button" onClick={showSchedule}><PanelTop size={15} />Return to schedule</button> : <small>Your teaching plan stays in place</small>}
          </header>
          <div className={`${styles.scheduleScroll} ${schedule.className ?? ""}`}>{schedule.children}</div>
        </main>

        {layout.right.length ? <WorkspaceRail side="right" ids={layout.right} items={visibleItems} activePanelId={activePanelId} arranging={arranging} draggedIdRef={draggedIdRef} onOpen={showPanel} onMove={moveTab} onNudge={nudgeTab} onSwitchSide={switchTabSide} /> : null}

        {activePanel ? <aside className={`${styles.panel} ${panelSide === "left" ? styles.panelLeft : styles.panelRight} ${activePanel.className ?? ""}`} data-spatial-id={activePanel.id} data-spatial-object aria-label={`${activePanel.label}: ${activePanel.title}`}>
          <header className={styles.panelHeader}>
            <button className={styles.panelBack} type="button" onClick={closePanel} aria-label="Back to schedule"><ChevronLeft size={16} /><span>Schedule</span></button>
            <button type="button" onClick={closePanel} aria-label={`Close ${activePanel.label}`}><X size={16} /></button>
          </header>
          <div className={styles.panelContent}>{activePanel.children}</div>
        </aside> : null}
      </div>

      {updateCount > 1 ? <div className={styles.layoutControls}>
        {layoutStatus !== "idle" ? <span className={`${styles.layoutStatus} ${layoutStatus === "error" ? styles.layoutError : ""}`} role="status">{layoutStatus === "saving" ? "Saving" : layoutStatus === "saved" ? <><Check size={12} />Saved</> : <><CloudOff size={12} />Not synced</>}</span> : null}
        <button type="button" aria-pressed={arranging} onClick={() => setArranging((value) => !value)}><Settings2 size={15} />{arranging ? "Done arranging" : "Arrange tabs"}</button>
        {arranging ? <button type="button" onClick={resetLayout} aria-label="Reset tab arrangement"><RotateCcw size={14} />Reset</button> : null}
      </div> : null}

      {arranging ? <p className={styles.arrangeHint}>Use the arrows or drag a tab to place it where you want.</p> : null}
      <div className={styles.assistant}>{assistant}</div>
    </div>
  );
}

function WorkspaceRail({ side, ids, items, activePanelId, arranging, draggedIdRef, onOpen, onMove, onNudge, onSwitchSide }: {
  side: Rail;
  ids: string[];
  items: Map<string, SpatialWorkspaceItem>;
  activePanelId: string | null;
  arranging: boolean;
  draggedIdRef: React.MutableRefObject<string | null>;
  onOpen: (id: string) => void;
  onMove: (id: string, side: Rail, index: number) => void;
  onNudge: (id: string, direction: -1 | 1) => void;
  onSwitchSide: (id: string) => void;
}) {
  return <nav className={`${styles.rail} ${side === "left" ? styles.railLeft : styles.railRight}`} aria-label={`${side === "left" ? "Left" : "Right"} workspace tabs`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = draggedIdRef.current; if (id) onMove(id, side, ids.length); draggedIdRef.current = null; }}>
    <div className={styles.railTabs}>
      {ids.map((id, index) => {
        const item = items.get(id);
        if (!item) return null;
        return <div className={`${styles.tabWrap} ${activePanelId === id ? styles.tabActive : ""}`} draggable={arranging} onDragStart={(event) => { draggedIdRef.current = id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", id); }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const draggedId = draggedIdRef.current; if (draggedId) onMove(draggedId, side, index); draggedIdRef.current = null; }} key={id}>
          <button className={styles.tab} type="button" onClick={() => onOpen(id)} aria-current={activePanelId === id ? "page" : undefined}>
            {arranging ? <GripVertical className={styles.grip} size={14} /> : null}
            <span>{item.label}</span>
            <small>{item.title}</small>
          </button>
          {arranging ? <div className={styles.tabActions} aria-label={`Arrange ${item.label}`}>
            <button type="button" onClick={() => onNudge(id, -1)} disabled={index === 0} aria-label={`Move ${item.label} up`}><ArrowUp size={12} /></button>
            <button type="button" onClick={() => onNudge(id, 1)} disabled={index === ids.length - 1} aria-label={`Move ${item.label} down`}><ArrowDown size={12} /></button>
            <button type="button" onClick={() => onSwitchSide(id)} aria-label={`Move ${item.label} to the ${side === "left" ? "right" : "left"}`}><ArrowLeftRight size={12} /></button>
          </div> : null}
        </div>;
      })}
    </div>
  </nav>;
}

export function workspaceRailLayout(items: SpatialWorkspaceItem[], homeItemId = "schedule", restored?: Record<string, Point>): WorkspaceRailLayout {
  const home = items.find((item) => item.id === homeItemId) ?? items[0];
  const candidates = items.filter((item) => item.id !== homeItemId && !item.hideLandmark);
  const sourcePosition = (item: SpatialWorkspaceItem) => {
    const position = restored?.[item.id];
    return position && validPosition(position) ? position : { x: item.x, y: item.y };
  };
  const sorted = [...candidates].sort((a, b) => sourcePosition(a).y - sourcePosition(b).y || candidates.indexOf(a) - candidates.indexOf(b));
  return {
    left: sorted.filter((item) => sourcePosition(item).x < (restored?.[home?.id]?.x ?? home?.x ?? 1600)).map((item) => item.id),
    right: sorted.filter((item) => sourcePosition(item).x >= (restored?.[home?.id]?.x ?? home?.x ?? 1600)).map((item) => item.id),
  };
}

export function moveWorkspaceTab(layout: WorkspaceRailLayout, id: string, side: Rail, requestedIndex: number): WorkspaceRailLayout {
  const without = {
    left: layout.left.filter((candidate) => candidate !== id),
    right: layout.right.filter((candidate) => candidate !== id),
  };
  const index = Math.max(0, Math.min(requestedIndex, without[side].length));
  const nextSide = [...without[side]];
  nextSide.splice(index, 0, id);
  return { ...without, [side]: nextSide };
}

export function workspaceRailPositions(items: SpatialWorkspaceItem[], homeItemId: string, layout: WorkspaceRailLayout) {
  const positions: Record<string, Point> = {};
  for (const item of items) {
    if (item.persistPosition === false) continue;
    if (item.id === homeItemId) positions[item.id] = { x: item.x, y: item.y };
  }
  layout.left.forEach((id, index) => { positions[id] = { x: LEFT_POSITION, y: (index + 1) * 100 }; });
  layout.right.forEach((id, index) => { positions[id] = { x: RIGHT_POSITION, y: (index + 1) * 100 }; });
  return positions;
}

function findRail(layout: WorkspaceRailLayout, id: string): Rail | null {
  if (layout.left.includes(id)) return "left";
  if (layout.right.includes(id)) return "right";
  return null;
}

function validPosition(position: Point) {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && position.x >= 0 && position.x <= 3200 && position.y >= 0 && position.y <= 2300;
}
