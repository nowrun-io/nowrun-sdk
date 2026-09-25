// Drape — app state + the agent command dispatcher.
// applyCommand() is the single entry point for agent-driven actions: today the
// in-app console calls it; later the nowrun poller (or platform channel /
// AppFunctions transport) calls the exact same function. Swapping the source
// requires zero UI changes — that's the point.

import { CATALOG, Collection, Sku, Slot, byId } from './catalog';

export type Outfit = Partial<Record<Slot, string>>; // slot -> sku id

export interface Palette {
  primary: string; // tintable top/dress/outerwear take this
  secondary: string; // tintable bottom/shoes/accessory take this
}

export type ColorOverrides = Partial<Record<Slot, string>>; // per-slot tint, wins over palette

export type Tab = 'shop' | 'looks';
export const TAB_LABELS: Record<Tab, string> = { shop: 'Shop', looks: 'The Look' };

export interface Look {
  id: string;
  name: string;
  outfit: Outfit;
  palette?: Palette | null;
  colorOverrides?: ColorOverrides;
}

export interface AppState {
  outfit: Outfit; // the working look on the board
  palette: Palette | null; // brand/mood colours applied to tintable garments
  colorOverrides: ColorOverrides; // per-slot tints, win over palette
  looks: Look[];
  lastAgentAction: string | null; // surfaced in the UI so agent changes are visible
}

export const initialState: AppState = {
  outfit: {},
  palette: null,
  colorOverrides: {},
  looks: [],
  lastAgentAction: null,
};

const PRIMARY_SLOTS: Slot[] = ['top', 'dress', 'outerwear'];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** The colour a SKU actually renders with, given palette + overrides. */
export function effectiveColor(sku: Sku, slot: Slot, palette: Palette | null, overrides: ColorOverrides): string {
  if (!sku.tintable) return sku.color;
  if (overrides[slot]) return overrides[slot]!;
  if (palette) return PRIMARY_SLOTS.includes(slot) ? palette.primary : palette.secondary;
  return sku.color;
}

export const outfitItems = (outfit: Outfit): Sku[] =>
  Object.values(outfit)
    .map((id) => byId(id!))
    .filter((s): s is Sku => !!s);

// ——— Commands (the tool surface) ———
// Mirrors the seven tools in the hackathon spec:
// get_state / search_catalog / set_outfit / swap_item / save_look /
// add_look_to_bag / checkout — plus set_palette for the demo beat.

export type Command =
  | { tool: 'get_state' }
  | { tool: 'search_catalog'; tags?: string[]; query?: string; slot?: Slot; collection?: Collection }
  | { tool: 'set_outfit'; slots: Outfit; replace?: boolean }
  | { tool: 'swap_item'; slot: Slot; id: string }
  | { tool: 'clear_slot'; slot: Slot }
  | { tool: 'set_palette'; mood?: 'warm' | 'cool'; primary?: string; secondary?: string }
  | { tool: 'set_color'; slot: Slot; color: string }
  | { tool: 'clear_palette' }
  | { tool: 'save_look'; name: string }
  | { tool: 'visualize'; on?: 'me' | 'avatar' }
  | { tool: 'switch_tab'; tab: Tab };

export interface CommandResult {
  state: AppState;
  reply: string; // what the agent (or console) reads back
  data?: unknown;
}

const DRESS_CLEARS: Slot[] = ['top', 'bottom'];

function setSlot(outfit: Outfit, slot: Slot, id: string): Outfit {
  const next = { ...outfit, [slot]: id };
  if (slot === 'dress') DRESS_CLEARS.forEach((s) => delete next[s]);
  if (DRESS_CLEARS.includes(slot)) delete next.dress;
  return next;
}

export function searchCatalog(opts: {
  tags?: string[];
  query?: string;
  slot?: Slot;
  collection?: Collection;
}): Sku[] {
  return CATALOG.filter((s) => {
    if (opts.slot && s.slot !== opts.slot) return false;
    if (opts.collection && s.collection !== opts.collection) return false;
    if (opts.tags?.length && !opts.tags.every((t) => s.tags.includes(t) || s.tone === t)) return false;
    if (opts.query && !s.name.toLowerCase().includes(opts.query.toLowerCase())) return false;
    return true;
  });
}

export function applyCommand(state: AppState, cmd: Command): CommandResult {
  switch (cmd.tool) {
    case 'get_state': {
      const summary = {
        outfit: state.outfit,
        palette: state.palette,
        color_overrides: state.colorOverrides,
        looks: state.looks.map((l) => ({ id: l.id, name: l.name })),
        catalog: CATALOG.map(({ id, name, slot, collection, tone, tintable, tags }) => ({ id, name, slot, collection, tone, tintable: !!tintable, tags })),
      };
      return { state, reply: `state: ${JSON.stringify(summary)}`, data: summary };
    }

    case 'search_catalog': {
      const hits = searchCatalog(cmd);
      return {
        state,
        reply: `${hits.length} match(es): ${hits.map((h) => `${h.id} ${h.name}`).join(' · ') || 'none'}`,
        data: hits,
      };
    }

    case 'set_outfit': {
      let outfit: Outfit = cmd.replace === false ? { ...state.outfit } : {};
      const applied: string[] = [];
      const rejected: string[] = [];
      (Object.entries(cmd.slots) as [Slot, string][]).forEach(([slot, id]) => {
        const sku = byId(id);
        if (sku && sku.slot === slot) {
          outfit = setSlot(outfit, slot, id);
          applied.push(`${slot}=${sku.name}`);
        } else {
          rejected.push(`${slot}=${id}`);
        }
      });
      const next = {
        ...state,
        outfit,
        lastAgentAction: `Outfit set (${applied.length} item${applied.length === 1 ? '' : 's'})`,
      };
      return {
        state: next,
        reply: `outfit set: ${applied.join(', ') || 'nothing'}${rejected.length ? `; rejected: ${rejected.join(', ')}` : ''}`,
      };
    }

    case 'swap_item': {
      const sku = byId(cmd.id);
      if (!sku || sku.slot !== cmd.slot) {
        return { state, reply: `error: ${cmd.id} is not a valid ${cmd.slot} item` };
      }
      const outfit = setSlot(state.outfit, cmd.slot, cmd.id);
      const colorOverrides = { ...state.colorOverrides };
      delete colorOverrides[cmd.slot]; // new garment arrives in its own colour
      return {
        state: { ...state, outfit, colorOverrides, lastAgentAction: `Swapped ${cmd.slot} → ${sku.name}` },
        reply: `${cmd.slot} is now ${sku.name}`,
      };
    }

    case 'clear_slot': {
      const outfit = { ...state.outfit };
      delete outfit[cmd.slot];
      const colorOverrides = { ...state.colorOverrides };
      delete colorOverrides[cmd.slot];
      return {
        state: { ...state, outfit, colorOverrides, lastAgentAction: `Cleared ${cmd.slot}` },
        reply: `${cmd.slot} cleared`,
      };
    }

    case 'set_palette': {
      // Two independent effects, combinable in one call:
      //  - primary/secondary hexes: recolour every tintable garment on the board
      //  - mood: swap non-matching items for same-slot items of that tone
      const actions: string[] = [];
      let outfit: Outfit = { ...state.outfit };
      let palette = state.palette;
      let colorOverrides = state.colorOverrides;

      if (cmd.primary || cmd.secondary) {
        const primary = cmd.primary ?? state.palette?.primary;
        const secondary = cmd.secondary ?? state.palette?.secondary ?? primary;
        if (!primary || !HEX_RE.test(primary) || !HEX_RE.test(secondary!)) {
          return { state, reply: 'error: primary/secondary must be hex colours like #B4432F' };
        }
        palette = { primary, secondary: secondary! };
        colorOverrides = {}; // a fresh palette clears per-slot tints
        actions.push(`palette ${primary}/${secondary}`);
      }

      if (cmd.mood) {
        const swaps: string[] = [];
        (Object.entries(outfit) as [Slot, string][]).forEach(([slot, id]) => {
          const current = byId(id);
          if (!current || current.tone === cmd.mood) return;
          const candidates = CATALOG.filter(
            (s) => s.slot === slot && s.tone === cmd.mood && s.id !== id,
          ).sort(
            (a, b) =>
              b.tags.filter((t) => current.tags.includes(t)).length -
              a.tags.filter((t) => current.tags.includes(t)).length,
          );
          if (candidates[0]) {
            outfit[slot] = candidates[0].id;
            swaps.push(`${current.name} → ${candidates[0].name}`);
          }
        });
        actions.push(swaps.length ? `${cmd.mood} mood (${swaps.join('; ')})` : `${cmd.mood} mood (no swaps)`);
      }

      if (!actions.length) return { state, reply: 'error: pass mood and/or primary/secondary' };
      return {
        state: { ...state, outfit, palette, colorOverrides, lastAgentAction: `Palette updated` },
        reply: `${actions.join(' · ')}`,
      };
    }

    case 'set_color': {
      if (!HEX_RE.test(cmd.color)) return { state, reply: 'error: colour must be hex like #2C3E5D' };
      const sku = state.outfit[cmd.slot] ? byId(state.outfit[cmd.slot]!) : null;
      if (!sku) return { state, reply: `error: no item in ${cmd.slot}` };
      if (!sku.tintable) return { state, reply: `error: ${sku.name} has a fixed colour (not tintable)` };
      return {
        state: {
          ...state,
          colorOverrides: { ...state.colorOverrides, [cmd.slot]: cmd.color },
          lastAgentAction: `${sku.name} → ${cmd.color}`,
        },
        reply: `${sku.name} tinted ${cmd.color}`,
      };
    }

    case 'clear_palette': {
      return {
        state: { ...state, palette: null, colorOverrides: {}, lastAgentAction: 'Palette cleared' },
        reply: 'palette and tints cleared — catalogue colours restored',
      };
    }

    case 'save_look': {
      if (!Object.keys(state.outfit).length) return { state, reply: 'error: board is empty' };
      const look: Look = {
        id: `look_${Date.now().toString(36)}`,
        name: cmd.name,
        outfit: { ...state.outfit },
        palette: state.palette,
        colorOverrides: { ...state.colorOverrides },
      };
      return {
        state: { ...state, looks: [...state.looks, look], lastAgentAction: `Saved look “${cmd.name}”` },
        reply: `saved look "${cmd.name}" (${look.id}), ${outfitItems(look.outfit).length} pieces`,
      };
    }

    case 'switch_tab': {
      if (!(cmd.tab in TAB_LABELS)) {
        return { state, reply: `error: tab must be one of ${Object.keys(TAB_LABELS).join(', ')}` };
      }
      const label = TAB_LABELS[cmd.tab];
      return { state: { ...state, lastAgentAction: `Showing ${label}` }, reply: `switched to ${label}` };
    }

    case 'visualize': {
      // Async render handled by the app layer (App.tsx startVisualize); this
      // just validates and acknowledges so the agent gets a sensible reply.
      if (!Object.keys(state.outfit).length) return { state, reply: 'error: board is empty — nothing to visualize' };
      return {
        state: { ...state, lastAgentAction: cmd.on === 'me' ? 'Rendering the look on you…' : 'Rendering the look…' },
        reply: `visualize: rendering ${outfitItems(state.outfit).length} pieces on ${cmd.on === 'me' ? 'your photo' : 'the avatar'} (~40s)`,
      };
    }

  }
}

export function parseCommand(raw: string): Command | { error: string } {
  try {
    const obj = JSON.parse(raw);
    if (!obj.tool) return { error: 'missing "tool"' };
    return obj as Command;
  } catch {
    return { error: 'invalid JSON' };
  }
}
