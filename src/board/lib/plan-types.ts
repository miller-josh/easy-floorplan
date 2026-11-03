// Types for data/plan-base.json and the layout state the editor saves.
// All coordinates are INCHES in a y-up plan frame (same frame as the DXF files).

/** Polyline / line. pts = [x0,y0,x1,y1,...]. c=1 means closed. */
export interface PrimPath { t: 'p'; pts: number[]; c?: 0 | 1; s: string; L: string }
/** Solid fill. tri = triangle vertex indices into pts (pre-triangulated for DXF SOLID export). o = opacity. */
export interface PrimFill { t: 'f'; pts: number[]; tri: number[]; f: string; o: number; L: string }
/** Circle. */
export interface PrimCircle { t: 'c'; x: number; y: number; r: number; s: string; L: string }
/** Text. h = cap height (in), r = rotation deg CCW, a = anchor: [l|c|r][t|m|b]. up=1: stays upright when the item rotates and keeps its size when the item is resized. */
export interface PrimText { t: 'x'; x: number; y: number; h: number; r: number; s: string; a: string; col: string; L: string; up?: 1 }
/** Boundary of a patterned hatch (outline only, not drawn; stripes are separate 'p' prims). */
export interface PrimHatchBoundary { t: 'h'; pts: number[]; s: string; L: string }
export type Prim = PrimPath | PrimFill | PrimCircle | PrimText | PrimHatchBoundary;

/** Layer names used: WALLS, SHELL, EQUIPMENT, DINING, LABELS, TAGS, CLEARANCE ZONES, OVERHEAD, DRIVE-THRU COUNTERS.
 *  TAGS prims are the circled letter tags: they never scale and stay upright. */
export type ItemKind = 'equip' | 'wall' | 'dining' | 'zone';

export interface PlanItem {
  id: number;            // stable id, referenced by LayoutState
  name: string;          // e.g. "Pizza oven", "Wall", "2-top table"
  tag: string | null;    // letter tag A..P or null
  kind: ItemKind;
  prims: Prim[];
}

export interface PlanBase {
  static: Prim[];        // exterior walls and fixed shell; never moves
  items: PlanItem[];     // everything movable
}

/** Per-item transform applied on top of the base geometry.
 *  World point = R(rot) * S(sx,sy) * (p - c) + c + (dx,dy), where c = center of the item's base bbox
 *  (bbox of prims excluding text, hatch boundaries and TAGS). */
export interface ItemTransform { dx: number; dy: number; rot: number; hidden: boolean; sx: number; sy: number }

/** A duplicate of an existing item ("Duplicate" button). id is a string so it never collides with base ids. */
export interface DupRef { id: string; src: number }

export interface LayoutState { t: Record<string, ItemTransform>; dups: DupRef[] }

/** What gets stored as the shared layout. rev increments on every save (optimistic concurrency). */
export interface SharedLayout { rev: number; savedAt: string | null; state: LayoutState }
