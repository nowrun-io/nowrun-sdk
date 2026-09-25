// Drape — outfits, co-edited by you and your AI.
// Demo app for the nowrun human+AI app model: every screen is equally usable by
// touch and by agent commands (see engine.ts / the console drawer).

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { byId, CATALOG, CATEGORIES, Collection, COLLECTIONS, Sku, Slot, SLOTS } from './catalog';
import { IMAGES } from './catalogImages';
import {
  AppState,
  applyCommand,
  Command,
  CommandResult,
  effectiveColor,
  initialState,
  outfitItems,
  parseCommand,
  Tab,
  TAB_LABELS,
} from './engine';
import { type Handlers, notifyState, type ToolSpec, useNowrun } from 'nowrun-expo';

const S = (name: string, description?: string): { name: string; type: 'String'; description?: string } => ({
  name,
  type: 'String',
  ...(description ? { description } : {}),
});

// Valid values, read from the catalog so the descriptions below never fall out of step with it.
const SLOT_NAMES = SLOTS.join(', ');
const TAG_NAMES = Array.from(new Set(CATALOG.flatMap((s) => s.tags))).sort().join(', ');
const TONE_NAMES = Array.from(new Set(CATALOG.map((s) => s.tone))).sort().join(', ');
const idsWhere = (keep: (s: Sku) => boolean) =>
  SLOTS.map((slot) => `${slot}: ${CATALOG.filter((s) => s.slot === slot && keep(s)).map((s) => s.id).join(', ')}`)
    .filter((entry) => !entry.endsWith(': '))
    .join('; ');
const ITEM_IDS_BY_SLOT = idsWhere(() => true);
const TINTABLE_IDS_BY_SLOT = idsWhere((s) => !!s.tintable);

// The tool surface a bridge-sdk client sees. The handlers below would be enough on their
// own - nowrun-expo derives the contract from their keys - but a client here is usually
// an LLM choosing a call, and `swap_item(slot, id)` tells it far more than `swap_item(args)`.
// The package warns in development if the two ever disagree.
// Every handler's result is serialized to a string over the wire (see nowrun-expo's
// sendResult()), so `returns` is always 'String' here - there is no richer type to report.
export const TOOLS: ToolSpec[] = [
  { functionName: 'get_state', args: [], returns: 'String', functionDescription: 'The current outfit, palette and saved looks.' },
  {
    functionName: 'search_catalog',
    returns: 'String',
    functionDescription: 'Finds catalog items by free-text query, slot, collection or tags. Read-only - does not change the outfit.',
    args: [
      S('query', 'Free-text match against an item\'s name and tags. Empty to skip.'),
      S('slot', 'One of top, bottom, dress, outerwear, shoes, accessory. Empty to match any slot.'),
      S('collection', 'One of essentials, coast, alpine, festive. Empty to match any collection.'),
      {
        name: 'tags',
        type: 'String[]',
        description: `Tags an item must all have, e.g. ["beach","summer"]. Empty to skip. Valid tags: ${TAG_NAMES}; a tone (${TONE_NAMES}) also matches.`,
      },
    ],
  },
  {
    functionName: 'set_outfit',
    returns: 'String',
    functionDescription: 'Sets multiple slots at once from a single map of slot to item id.',
    // The comma-bearing argument goes last: a client joins arguments with commas and splits
    // on the first ones, so only the final value keeps its own.
    args: [
      { name: 'replace', type: 'boolean', description: 'true clears every slot first; false only overwrites the slots named in slots.' },
      {
        name: 'slots',
        type: 'JSONObject',
        description: `Map of slot name to item id, e.g. {"top":"alp_01","shoes":"alp_08"}. Keys: ${SLOT_NAMES}. Each id must belong to its slot - ${ITEM_IDS_BY_SLOT}.`,
      },
    ],
  },
  {
    functionName: 'swap_item',
    returns: 'String',
    functionDescription: 'Puts one item into one slot, replacing whatever was there.',
    args: [
      S('slot', `The slot to fill. One of ${SLOT_NAMES}.`),
      S('id', `The catalog item id to place there; it must belong to that slot - ${ITEM_IDS_BY_SLOT}.`),
    ],
  },
  { functionName: 'clear_slot', returns: 'String', functionDescription: 'Empties one slot.', args: [S('slot', `The slot to empty. One of ${SLOT_NAMES}.`)] },
  {
    functionName: 'set_palette',
    returns: 'String',
    functionDescription: 'Sets the outfit\'s overall color mood and two accent colors.',
    args: [
      S('mood', `One of ${TONE_NAMES}: swaps each item for a same-slot item of that tone. Empty to skip.`),
      S('primary', 'Primary accent color, as a hex string like "#4A4A44".'),
      S('secondary', 'Secondary accent color, as a hex string like "#8B5E3C".'),
    ],
  },
  {
    functionName: 'set_color',
    returns: 'String',
    functionDescription: 'Overrides the color of one tintable item in one slot, without changing the palette.',
    args: [
      S('slot', `The slot whose item to recolor. It must hold a tintable item - ${TINTABLE_IDS_BY_SLOT}.`),
      S('color', 'Hex color, e.g. "#334455".'),
    ],
  },
  { functionName: 'clear_palette', returns: 'String', functionDescription: 'Removes the palette and any per-slot color overrides.', args: [] },
  { functionName: 'save_look', returns: 'String', functionDescription: 'Saves the current outfit under a name, for recall later.', args: [S('name', 'Name to save the current outfit under.')] },
  {
    functionName: 'visualize',
    returns: 'String',
    functionDescription: 'Requests a rendered preview of the current outfit on the avatar.',
    args: [S('on', '"avatar" to render on the model, "me" to render on the user\'s photo.')],
  },
  {
    functionName: 'switch_tab',
    returns: 'String',
    functionDescription:
      'Switches the screen the user sees. Changes nothing else. "shop" is the catalogue: every item as a card, ' +
      'filterable by collection and by category (slot), with a detail view to add an item to the look. ' +
      '"looks" is The Look: the outfit board with one cell per slot, the palette in use, the try-on render ' +
      'and its result, a button to save the look, and the saved looks, each of which can be reopened.',
    args: [
      {
        name: 'tab',
        type: 'String',
        description: 'One of shop (the Shop tab) or looks (The Look tab).',
      },
    ],
  },
];

const STORAGE_KEY = 'drape_state_v1';

// Visualize API lives on the Vercel deployment; same-origin on web, absolute in the APK.
const VIZ_BASE = Platform.OS === 'web' ? '' : 'https://nowrun-drape.vercel.app';

type VizState =
  | { status: 'idle' }
  | { status: 'gen'; key: string }
  | { status: 'done'; key: string; url: string }
  | { status: 'failed'; key: string; error: string };

/**
 * Single rendering path for a garment everywhere in the app.
 * With a generated ghost-mannequin PNG: image + optional live tint overlay.
 * Without: colour swatch + glyph placeholder.
 */
function GarmentVisual({
  sku,
  tint,
  glyphSize = 42,
  style,
}: {
  sku: Sku;
  tint?: string; // effective colour (palette/override); only applied if it differs from base
  glyphSize?: number;
  style?: object;
}) {
  const tinted = sku.tintable && tint && tint.toLowerCase() !== sku.color.toLowerCase();
  const img = IMAGES[sku.id];
  const fade = useRef(new Animated.Value(1)).current;
  const lastKey = useRef(sku.id);
  useEffect(() => {
    if (lastKey.current !== sku.id) {
      lastKey.current = sku.id;
      fade.setValue(0.25);
      Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: false }).start();
    }
  }, [sku.id, fade]);
  if (img) {
    return (
      <Animated.View style={[vs.box, vs.imgBg, style, { opacity: fade }]}>
        <Image source={img} style={vs.img} resizeMode="cover" />
        {tinted && <View style={[vs.tintOverlay, { backgroundColor: tint }]} />}
      </Animated.View>
    );
  }
  return (
    <Animated.View style={[vs.box, { backgroundColor: tint ?? sku.color }, style, { opacity: fade }]}>
      <Text style={{ fontSize: glyphSize }}>{sku.glyph}</Text>
    </Animated.View>
  );
}

const vs = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  imgBg: { backgroundColor: '#E9E4DC' },
  img: { width: '100%', height: '100%' },
  tintOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.5,
    ...(Platform.OS === 'web' ? ({ mixBlendMode: 'multiply' } as object) : {}),
  },
});

const QUICK_COMMANDS: { label: string; cmd: Command }[] = [
  { label: 'Rainy wedding options', cmd: { tool: 'search_catalog', tags: ['wedding', 'rainy-ok'] } },
  {
    label: 'Dress me: rainy wedding',
    cmd: {
      tool: 'set_outfit',
      slots: { top: 'top_05', bottom: 'bot_02', outerwear: 'out_04', shoes: 'sho_02', accessory: 'acc_04' },
    },
  },
  { label: 'Make it warm-toned', cmd: { tool: 'set_palette', mood: 'warm' } },
  { label: 'Make it cool-toned', cmd: { tool: 'set_palette', mood: 'cool' } },
  { label: 'My brand colours', cmd: { tool: 'set_palette', primary: '#B4432F', secondary: '#EFE6D8' } },
  { label: 'Tint top forest', cmd: { tool: 'set_color', slot: 'top', color: '#2F4A3C' } },
  { label: 'Reset colours', cmd: { tool: 'clear_palette' } },
  {
    label: 'Dress me: Diwali dinner',
    cmd: {
      tool: 'set_outfit',
      slots: { top: 'fst_02', bottom: 'fst_07', outerwear: 'fst_05', shoes: 'fst_09a', accessory: 'fst_08' },
    },
  },
  {
    label: 'Dress me: Himalayan trek',
    cmd: {
      tool: 'set_outfit',
      slots: { top: 'alp_02', bottom: 'alp_04', outerwear: 'alp_06', shoes: 'alp_08', accessory: 'alp_10' },
    },
  },
  { label: 'Beach day options', cmd: { tool: 'search_catalog', tags: ['beach'] } },
  { label: '✨ Try on the model', cmd: { tool: 'visualize', on: 'avatar' } },
  { label: '📷 Try it on me', cmd: { tool: 'visualize', on: 'me' } },
  { label: 'Save as “Goa wedding”', cmd: { tool: 'save_look', name: 'Goa wedding' } },
];

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [tab, setTab] = useState<Tab>('shop');
  const [category, setCategory] = useState<Slot | 'all'>('all');
  const [collection, setCollection] = useState<Collection | 'all'>('all');
  const [detail, setDetail] = useState<Sku | null>(null);
  const [slotPicker, setSlotPicker] = useState<Slot | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleInput, setConsoleInput] = useState('');
  const [consoleLog, setConsoleLog] = useState<{ dir: 'in' | 'out'; text: string }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [viz, setViz] = useState<VizState>({ status: 'idle' });
  const [selfieId, setSelfieId] = useState<string | null>(null);
  const [selfieThumb, setSelfieThumb] = useState<string | null>(null);
  const [tryOnOpen, setTryOnOpen] = useState(false);
  const loaded = useRef(false);

  // "Dress me": pick a photo, upload it once, reuse its identity id for renders.
  const pickSelfie = async (): Promise<string | null> => {
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
      });
      if (picked.canceled || !picked.assets?.[0]?.uri) return null;
      setToast('Uploading your photo…');
      // Resize + re-encode: keeps uploads ~200-500KB and yields base64 on every platform.
      const small = await ImageManipulator.manipulateAsync(
        picked.assets[0].uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!small.base64) throw new Error('could not read the photo');
      const thumb = await ImageManipulator.manipulateAsync(
        picked.assets[0].uri,
        [{ resize: { width: 160 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (thumb.base64) {
        const uri = `data:image/jpeg;base64,${thumb.base64}`;
        setSelfieThumb(uri);
        AsyncStorage.setItem('drape_selfie_thumb', uri).catch(() => {});
      }
      const res = await fetch(`${VIZ_BASE}/api/selfie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: small.base64, mime: 'image/jpeg' }),
      });
      const out = await res.json();
      if (!res.ok || !out.identityId) throw new Error(out.error || 'upload failed');
      setSelfieId(out.identityId);
      AsyncStorage.setItem('drape_selfie', out.identityId).catch(() => {});
      setToast('Photo saved — renders will use you now');
      return out.identityId;
    } catch (e) {
      setToast(`Photo upload failed: ${String((e as Error).message || e).slice(0, 80)}`);
      return null;
    }
  };

  const startVisualize = async (outfit: typeof state.outfit, identityId?: string | null) => {
    const skuIds = Object.values(outfit).filter(Boolean) as string[];
    if (!skuIds.length) return;
    const key = (identityId ? `me:${identityId}+` : '') + [...skuIds].sort().join('+');
    const cached = await AsyncStorage.getItem(`viz_${key}`).catch(() => null);
    if (cached) return setViz({ status: 'done', key, url: cached });
    setViz({ status: 'gen', key });
    try {
      const startRes = await fetch(`${VIZ_BASE}/api/visualize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skuIds, identityId: identityId || undefined }),
      });
      const start = await startRes.json();
      if (!startRes.ok || !start.id) throw new Error(start.error || 'failed to start');
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 4000));
        const pollRes = await fetch(`${VIZ_BASE}/api/visualize?id=${encodeURIComponent(start.id)}`);
        const poll = await pollRes.json();
        if (poll.status === 'completed' && poll.url) {
          AsyncStorage.setItem(`viz_${key}`, poll.url).catch(() => {});
          setViz({ status: 'done', key, url: poll.url });
          return;
        }
        if (poll.status === 'failed') throw new Error('render failed');
      }
      throw new Error('timed out');
    } catch (e) {
      setViz({ status: 'failed', key, error: String((e as Error).message || e) });
    }
  };

  // ——— remote command channel: real agents (custom GPT / send_to_app) drive the app ———
  const cmdCursor = useRef<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const vizRef = useRef(viz);
  vizRef.current = viz;
  const selfieRef = useRef(selfieId);
  selfieRef.current = selfieId;

  // Leader election: with several tabs open, exactly one owns polling + publishing.
  // A tab claims/renews an 8s lease in localStorage; the rest stay passive.
  const tabId = useRef(Math.random().toString(36).slice(2)).current;
  const isLeader = () => {
    if (Platform.OS !== 'web') return true;
    try {
      const raw = window.localStorage.getItem('drape_leader');
      const now = Date.now();
      if (raw) {
        const lease = JSON.parse(raw) as { id: string; ts: number };
        if (lease.id !== tabId && now - lease.ts < 8000) return false;
      }
      window.localStorage.setItem('drape_leader', JSON.stringify({ id: tabId, ts: now }));
      return true;
    } catch {
      return true;
    }
  };

  const publishState = () => {
    const summary = applyCommand(stateRef.current, { tool: 'get_state' }).data as Record<string, unknown>;
    const v = vizRef.current;
    const payload = {
      ...summary,
      has_photo: !!selfieRef.current,
      render: v.status === 'done' ? { status: 'done', url: v.url } : { status: v.status },
    };
    // Bridge client, if one is bound. No leader election: on Android this is one process.
    notifyState(payload);
    if (!isLeader()) return;
    fetch(`${VIZ_BASE}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: payload }),
    }).catch(() => {});
  };

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!isLeader()) return;
      try {
        const res = await fetch(`${VIZ_BASE}/api/command?after=${encodeURIComponent(cmdCursor.current ?? '')}`);
        const out = await res.json();
        if (!alive || !out) return;
        if (cmdCursor.current === null) {
          // First poll is a handshake: adopt the cursor, never replay old commands.
          cmdCursor.current = out.cursor || '';
          return;
        }
        cmdCursor.current = out.cursor || cmdCursor.current;
        for (const entry of out.commands || []) {
          runCommand(entry.command as Command, true);
        }
      } catch {}
    };
    const iv = setInterval(tick, 2500);
    const hb = setInterval(publishState, 25000); // keep-alive: state never expires while a tab is open
    tick();
    return () => { alive = false; clearInterval(iv); clearInterval(hb); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Publish app state (debounced) so the agent can read what it's working with.
  useEffect(() => {
    const t = setTimeout(publishState, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, viz, selfieId]);

  // ——— persistence ———
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          setState({ ...initialState, ...JSON.parse(raw), lastAgentAction: null });
        } catch {}
      }
      loaded.current = true;
    });
    AsyncStorage.getItem('drape_selfie').then((id) => id && setSelfieId(id)).catch(() => {});
    AsyncStorage.getItem('drape_selfie_thumb').then((t) => t && setSelfieThumb(t)).catch(() => {});
  }, []);
  useEffect(() => {
    if (loaded.current) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state]);

  // ——— agent action toast ———
  useEffect(() => {
    if (!state.lastAgentAction) return;
    setToast(state.lastAgentAction);
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [state.lastAgentAction]);

  const runCommand = (cmd: Command, echo = true, onResult?: (res: CommandResult) => void) => {
    if (echo) setConsoleLog((l) => [...l, { dir: 'in', text: JSON.stringify(cmd) }]);
    setState((prev) => {
      const res = applyCommand(prev, cmd);
      setConsoleLog((l) => [...l, { dir: 'out', text: res.reply }]);
      onResult?.(res);
      if (cmd.tool === 'visualize' && Object.keys(prev.outfit).length) {
        if (cmd.on === 'me') {
          (selfieId ? Promise.resolve(selfieId) : pickSelfie()).then((id) => {
            if (id) startVisualize(prev.outfit, id);
          });
        } else {
          startVisualize(prev.outfit);
        }
        setTab('looks');
      }
      if (cmd.tool === 'switch_tab' && !res.reply.startsWith('error:')) {
        setTab(cmd.tab);
      }
      return res.state;
    });
  };

  // A bridge-sdk client drives the very same dispatcher the console and the GPT use.
  const bridgeHandlers = useMemo<Handlers>(
    () =>
      Object.fromEntries(
        TOOLS.map(({ functionName }) => [
          functionName,
          // applyCommand's reply is only available inside the state update, so the answer
          // is a promise the dispatcher settles.
          (args: Record<string, unknown>) =>
            new Promise((resolve) =>
              runCommand({ tool: functionName, ...args } as Command, true, (res) =>
                resolve({
                  success: !res.reply.startsWith('error:'),
                  response: res.reply,
                  data: res.data,
                }),
              ),
            ),
        ]),
      ),
    // runCommand is redefined every render but always does the same thing; the package
    // reads handlers through a ref, so this only needs to be built once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useNowrun(bridgeHandlers, { tools: TOOLS });

  const submitConsole = () => {
    const parsed = parseCommand(consoleInput);
    if ('error' in parsed) {
      setConsoleLog((l) => [
        ...l,
        { dir: 'in', text: consoleInput },
        { dir: 'out', text: `parse error: ${parsed.error}` },
      ]);
    } else {
      runCommand(parsed);
    }
    setConsoleInput('');
  };

  // ——— shop data ———
  const products = useMemo(
    () =>
      CATALOG.filter(
        (s) => (category === 'all' || s.slot === category) && (collection === 'all' || s.collection === collection),
      ),
    [category, collection],
  );

  const addToLook = (sku: Sku) => {
    runCommand({ tool: 'swap_item', slot: sku.slot, id: sku.id }, false);
    setDetail(null);
    setTab('looks');
  };

  // Desktop web -> present the app inside a phone frame; real mobile stays edge-to-edge.
  const win = useWindowDimensions();
  const framed = Platform.OS === 'web' && win.width > 520;

  const app = (
    <SafeAreaView style={st.root}>
      <StatusBar style="dark" />

      {/* ——— header ——— */}
      <View style={st.header}>
        <Text style={st.brand}>DRAPE</Text>
        <Text style={st.brandSub}>outfits, co-edited by you and your AI</Text>
      </View>

      {/* ——— agent toast ——— */}
      {toast && (
        <View style={st.toast} pointerEvents="none">
          <Text style={st.toastDot}>✦</Text>
          <Text style={st.toastText}>{toast}</Text>
        </View>
      )}

      {/* ——— content ——— */}
      {tab === 'shop' && (
        <View style={st.flex}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.collRow} contentContainerStyle={st.catRowInner}>
            {COLLECTIONS.map((c) => (
              <Pressable key={c.key} onPress={() => setCollection(c.key)} style={[st.collChip, collection === c.key && st.collChipOn]}>
                <Text style={[st.collChipText, collection === c.key && st.collChipTextOn]}>{c.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.catRow} contentContainerStyle={st.catRowInner}>
            {CATEGORIES.map((c) => (
              <Pressable key={c.key} onPress={() => setCategory(c.key)} style={[st.chip, category === c.key && st.chipOn]}>
                <Text style={[st.chipText, category === c.key && st.chipTextOn]}>{c.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <FlatList
            data={products}
            keyExtractor={(s) => s.id}
            numColumns={2}
            columnWrapperStyle={st.gridRow}
            contentContainerStyle={st.gridPad}
            renderItem={({ item }) => (
              <Pressable style={st.card} onPress={() => setDetail(item)}>
                <GarmentVisual sku={item} style={st.swatch} />
                <Text style={st.cardName} numberOfLines={1}>{item.name}</Text>
                <View style={st.cardMeta}>
                  <Text style={st.cardColorway}>
                    {item.colorGroup ? `${CATALOG.filter((x) => x.colorGroup === item.colorGroup).length} colours` : ''}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        </View>
      )}

      {tab === 'looks' && (
        <ScrollView style={st.flex} contentContainerStyle={st.looksPad}>
          <View style={st.sectionRow}>
            <Text style={st.sectionTitle}>The look</Text>
            {state.palette && (
              <Pressable style={st.paletteBadge} onPress={() => runCommand({ tool: 'clear_palette' }, false)}>
                <View style={[st.paletteDot, { backgroundColor: state.palette.primary }]} />
                <View style={[st.paletteDot, { backgroundColor: state.palette.secondary }]} />
                <Text style={st.paletteClear}>clear ✕</Text>
              </Pressable>
            )}
          </View>

          {/* ——— the one board: every slot, filled or empty ——— */}
          {(() => {
            const cellFor = (slot: Slot, style: object, glyphSize = 34) => {
              const id = state.outfit[slot];
              const sku = id ? byId(id) : null;
              if (!sku) {
                return (
                  <Pressable key={`${slot}:empty`} style={[st.gridCell, st.gridEmpty, style]} onPress={() => setSlotPicker(slot)}>
                    <Text style={st.gridEmptyPlus}>+</Text>
                    <Text style={st.gridEmptyLabel}>{slot}</Text>
                  </Pressable>
                );
              }
              const tint = effectiveColor(sku, slot, state.palette, state.colorOverrides);
              return (
                <Pressable key={`${slot}:${sku.id}`} style={[st.gridCell, style]} onPress={() => setSlotPicker(slot)}>
                  <GarmentVisual sku={sku} tint={tint} glyphSize={glyphSize} style={st.gridFill} />
                  <View style={st.cellTag}>
                    <Text style={st.cellTagText} numberOfLines={1}>{sku.name}</Text>
                  </View>
                </Pressable>
              );
            };
            const heroSlot: Slot = state.outfit.dress ? 'dress' : 'top';
            return (
              <View style={st.canvas}>
                <View style={st.gridMainRow}>
                  {cellFor(heroSlot, st.gridHero, 64)}
                  <View style={st.gridSideCol}>
                    {cellFor('outerwear', st.gridSideCell)}
                    {cellFor('bottom', st.gridSideCell)}
                  </View>
                </View>
                <View style={st.gridStripRow}>
                  {cellFor('shoes', st.gridStripCell, 26)}
                  {cellFor('accessory', st.gridStripCell, 26)}
                  <Pressable
                    style={[st.gridStripCell, st.gridVizCell]}
                    onPress={() => {
                      if (!Object.keys(state.outfit).length) { setToast('Add a few pieces first'); return; }
                      setTryOnOpen(true);
                    }}
                  >
                    <Text style={st.gridVizGlyph}>✨</Text>
                    <Text style={st.gridVizLabel}>Try it on</Text>
                  </Pressable>
                </View>
              </View>
            );
          })()}

          {/* ——— try-on render status / result ——— */}
          {(() => {
            const baseKey = (Object.values(state.outfit).filter(Boolean) as string[]).sort().join('+');
            if (viz.status === 'idle' || !baseKey) return null;
            const stale = viz.status !== 'gen' && !viz.key.endsWith(baseKey);
            return (
              <View style={st.vizBlock}>
                {stale ? (
                  <Pressable style={[st.btn, st.btnGhost, st.vizBtn]} onPress={() => setTryOnOpen(true)}>
                    <Text style={st.btnGhostText}>✨ Look changed — try it on again</Text>
                  </Pressable>
                ) : viz.status === 'gen' ? (
                  <View style={st.vizCard}>
                    <Text style={st.vizGenGlyph}>✨</Text>
                    <Text style={st.vizGenText}>
                      {viz.key.startsWith('me:') ? 'Rendering this look on you…' : 'Rendering this look on the avatar…'}
                    </Text>
                    <Text style={st.vizGenSub}>about 40 seconds</Text>
                  </View>
                ) : viz.status === 'done' ? (
                  <View style={st.vizCard}>
                    <Image source={{ uri: viz.url }} style={st.vizImage} resizeMode="cover" />
                    <View style={st.vizActions}>
                      <Pressable onPress={() => { AsyncStorage.removeItem(`viz_${viz.key}`).catch(() => {}); setTryOnOpen(true); }}>
                        <Text style={st.vizActionText}>↻ Again</Text>
                      </Pressable>
                      <Pressable onPress={() => setViz({ status: 'idle' })}>
                        <Text style={st.vizActionText}>Close</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={st.vizCard}>
                    <Text style={st.vizGenText}>Render failed — {viz.status === 'failed' ? viz.error : ''}</Text>
                    <Pressable style={[st.btn, st.vizBtn]} onPress={() => setTryOnOpen(true)}>
                      <Text style={st.btnText}>Try again</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })()}

          <View style={st.lookFooter}>
            <Text style={st.lookCount}>
              {outfitItems(state.outfit).length ? `${outfitItems(state.outfit).length} pieces` : 'Tap a slot to start'}
            </Text>
            <Pressable
              style={st.btn}
              onPress={() => runCommand({ tool: 'save_look', name: `Look ${state.looks.length + 1}` }, false)}
            >
              <Text style={st.btnText}>Save this look</Text>
            </Pressable>
          </View>

          {state.looks.length > 0 && (
            <>
              <Text style={st.sectionTitle}>Saved looks</Text>
              {state.looks.map((l) => (
                <Pressable
                  key={l.id}
                  style={st.savedLook}
                  onPress={() =>
                    setState((p) => ({
                      ...p,
                      outfit: { ...l.outfit },
                      palette: l.palette ?? null,
                      colorOverrides: { ...(l.colorOverrides ?? {}) },
                    }))
                  }
                >
                  <View style={st.savedSwatches}>
                    {(Object.entries(l.outfit) as [Slot, string][]).slice(0, 5).map(([slot, id]) => {
                      const s = byId(id)!;
                      return (
                        <View key={s.id} style={[st.miniSwatch, { backgroundColor: effectiveColor(s, slot, l.palette ?? null, l.colorOverrides ?? {}) }]}>
                          <Text style={st.miniGlyph}>{s.glyph}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <View style={st.flex}>
                    <Text style={st.savedName}>{l.name}</Text>
                    <Text style={st.savedMeta}>{outfitItems(l.outfit).length} pieces</Text>
                  </View>
                  <Text style={st.savedOpen}>Open</Text>
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* ——— tab bar ——— */}
      <View style={st.tabBar}>
        {(['shop', 'looks'] as Tab[]).map((t) => (
          <Pressable key={t} style={st.tabBtn} onPress={() => setTab(t)}>
            <Text style={[st.tabText, tab === t && st.tabTextOn]}>
              {TAB_LABELS[t]}
            </Text>
          </Pressable>
        ))}
        <Pressable style={st.tabBtn} onPress={() => setConsoleOpen(true)}>
          <Text style={[st.tabText, st.agentTab]}>✦ Agent</Text>
        </Pressable>
      </View>

      {/* ——— product detail sheet ——— */}
      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <Pressable style={st.sheetBackdrop} onPress={() => setDetail(null)}>
          <Pressable style={st.sheet} onPress={() => {}}>
            {detail && (
              <>
                <GarmentVisual sku={detail} glyphSize={64} style={st.sheetSwatch} />
                <Text style={st.sheetName}>{detail.name}</Text>
                <Text style={st.sheetPrice}>{detail.collection.toUpperCase()}</Text>
                {detail.colorGroup && (
                  <View style={st.colorwayRow}>
                    {CATALOG.filter((s) => s.colorGroup === detail.colorGroup).map((s) => (
                      <Pressable key={s.id} onPress={() => setDetail(s)} style={[st.colorwayDot, { backgroundColor: s.color }, s.id === detail.id && st.colorwayDotOn]} />
                    ))}
                  </View>
                )}
                <View style={st.tagRow}>
                  {detail.tags.map((t) => (
                    <Text key={t} style={st.tag}>{t}</Text>
                  ))}
                </View>
                <Pressable style={[st.btn, st.btnWide]} onPress={() => addToLook(detail)}>
                  <Text style={st.btnText}>Add to look</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ——— slot picker ——— */}
      <Modal visible={!!slotPicker} transparent animationType="slide" onRequestClose={() => setSlotPicker(null)}>
        <Pressable style={st.sheetBackdrop} onPress={() => setSlotPicker(null)}>
          <Pressable style={[st.sheet, st.sheetTall]} onPress={() => {}}>
            <Text style={st.sheetName}>Pick {slotPicker}</Text>
            <ScrollView style={st.flex}>
              {slotPicker &&
                CATALOG.filter((s) => s.slot === slotPicker).map((s) => (
                  <Pressable
                    key={s.id}
                    style={st.pickRow}
                    onPress={() => {
                      runCommand({ tool: 'swap_item', slot: s.slot, id: s.id }, false);
                      setSlotPicker(null);
                    }}
                  >
                    <GarmentVisual sku={s} glyphSize={15} style={st.pickThumb} />
                    <Text style={[st.flex, st.pickName]}>{s.name}</Text>
                  </Pressable>
                ))}
              {slotPicker && state.outfit[slotPicker] && (
                <Pressable
                  style={st.pickRow}
                  onPress={() => {
                    runCommand({ tool: 'clear_slot', slot: slotPicker }, false);
                    setSlotPicker(null);
                  }}
                >
                  <Text style={[st.flex, st.pickClear]}>Remove item</Text>
                </Pressable>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ——— try-on chooser ——— */}
      <Modal visible={tryOnOpen} transparent animationType="slide" onRequestClose={() => setTryOnOpen(false)}>
        <Pressable style={st.sheetBackdrop} onPress={() => setTryOnOpen(false)}>
          <Pressable style={st.sheet} onPress={() => {}}>
            <Text style={st.sheetName}>✨ Try it on</Text>
            <Text style={st.trySub}>Render this look as a photo</Text>
            <Pressable
              style={st.tryRow}
              onPress={() => { setTryOnOpen(false); runCommand({ tool: 'visualize', on: 'avatar' }, false); }}
            >
              <Text style={st.tryRowGlyph}>👤</Text>
              <View style={st.flex}>
                <Text style={st.tryRowTitle}>On the model</Text>
                <Text style={st.tryRowSub}>The Drape avatar wears your look</Text>
              </View>
            </Pressable>
            <Pressable
              style={st.tryRow}
              onPress={() => { setTryOnOpen(false); runCommand({ tool: 'visualize', on: 'me' }, false); }}
            >
              {selfieThumb ? (
                <Image source={{ uri: selfieThumb }} style={st.tryThumb} />
              ) : (
                <Text style={st.tryRowGlyph}>📷</Text>
              )}
              <View style={st.flex}>
                <Text style={st.tryRowTitle}>On me</Text>
                <Text style={st.tryRowSub}>{selfieId ? 'Uses this photo of you' : 'Add a photo of yourself first'}</Text>
              </View>
            </Pressable>
            {selfieId && (
              <Pressable onPress={() => { setTryOnOpen(false); pickSelfie(); }}>
                <Text style={st.tryChange}>Change my photo</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ——— agent console ——— */}
      <Modal visible={consoleOpen} transparent animationType="slide" onRequestClose={() => setConsoleOpen(false)}>
        <Pressable style={st.sheetBackdrop} onPress={() => setConsoleOpen(false)}>
          <Pressable style={[st.sheet, st.sheetTall, st.consoleSheet]} onPress={() => {}}>
            <Text style={st.consoleTitle}>✦ Agent console</Text>
            <Text style={st.consoleSub}>
              Simulates the ChatGPT → nowrun command channel. Same dispatcher the real channel will call.
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.quickRow}>
              {QUICK_COMMANDS.map((q) => (
                <Pressable key={q.label} style={st.quickChip} onPress={() => runCommand(q.cmd)}>
                  <Text style={st.quickChipText}>{q.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <ScrollView style={st.consoleLog} contentContainerStyle={st.consoleLogPad}>
              {consoleLog.length === 0 && <Text style={st.consoleHint}>Try a quick command above, or send JSON like{'\n'}{`{"tool":"set_palette","mood":"warm"}`}</Text>}
              {consoleLog.map((line, i) => (
                <Text key={i} style={[st.consoleLine, line.dir === 'in' ? st.consoleIn : st.consoleOut]}>
                  {line.dir === 'in' ? '→ ' : '← '}
                  {line.text}
                </Text>
              ))}
            </ScrollView>
            <View style={st.consoleInputRow}>
              <TextInput
                style={st.consoleInput}
                value={consoleInput}
                onChangeText={setConsoleInput}
                placeholder='{"tool":"..."}'
                placeholderTextColor="#8a8a8e"
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={submitConsole}
              />
              <Pressable style={st.btn} onPress={submitConsole}>
                <Text style={st.btnText}>Send</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );

  if (!framed) return app;
  return (
    <View style={st.deskWrap}>
      <View style={[st.phoneFrame, { height: Math.min(win.height - 64, 880) }]}>{app}</View>
      <Text style={st.deskCaption}>DRAPE — outfits, co-edited by you and your AI</Text>
    </View>
  );
}

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FAF8F4' },
  deskWrap: { flex: 1, backgroundColor: '#211E1A', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  phoneFrame: {
    width: 402, maxWidth: '100%', borderRadius: 34, overflow: 'hidden', backgroundColor: '#FAF8F4',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 60, shadowOffset: { width: 0, height: 24 },
  },
  deskCaption: { color: '#8A8580', fontSize: 12, letterSpacing: 1.2 },
  flex: { flex: 1 },
  header: { paddingTop: Platform.OS === 'web' ? 18 : 8, paddingBottom: 10, alignItems: 'center' },
  brand: { fontSize: 26, fontWeight: '800', letterSpacing: 8, color: '#17161A' },
  brandSub: { fontSize: 11, color: '#8A8580', marginTop: 2, letterSpacing: 0.4 },

  toast: {
    position: 'absolute', top: 64, alignSelf: 'center', zIndex: 20, flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#17161A', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, gap: 7,
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  toastDot: { color: '#E8C877', fontSize: 12 },
  toastText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },

  collRow: { height: 40, flexGrow: 0, flexShrink: 0 },
  collChip: { paddingHorizontal: 4, paddingVertical: 8, marginRight: 14 },
  collChipOn: { borderBottomWidth: 2, borderBottomColor: '#17161A' },
  collChipText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.6, color: '#A39C92', textTransform: 'uppercase' },
  collChipTextOn: { color: '#17161A' },
  catRow: { height: 44, flexGrow: 0, flexShrink: 0, marginBottom: 2 },
  catRowInner: { paddingHorizontal: 14, gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: '#E2DDD4', backgroundColor: '#fff' },
  chipOn: { backgroundColor: '#17161A', borderColor: '#17161A' },
  chipText: { fontSize: 12.5, color: '#54504A', fontWeight: '600' },
  chipTextOn: { color: '#fff' },

  gridPad: { padding: 10, paddingBottom: 90 },
  gridRow: { gap: 10, paddingHorizontal: 4, marginBottom: 10 },
  card: { flex: 1, backgroundColor: '#fff', borderRadius: 14, padding: 8, borderWidth: 1, borderColor: '#EEE9E0' },
  swatch: { height: 120, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  swatchGlyph: { fontSize: 42 },
  cardName: { fontSize: 13, fontWeight: '600', color: '#17161A', marginTop: 8, marginHorizontal: 2 },
  cardMeta: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 2, marginTop: 2 },
  cardPrice: { fontSize: 12.5, color: '#54504A' },
  cardColorway: { fontSize: 11, color: '#A39C92' },

  looksPad: { padding: 14, paddingBottom: 90 },
  canvas: {
    borderRadius: 20, backgroundColor: '#F3EFE7', borderWidth: 1, borderColor: '#E6DFD2',
    marginBottom: 16, padding: 10, gap: 10,
  },
  gridMainRow: { flexDirection: 'row', gap: 10, height: 268 },
  gridHero: { flex: 1.45 },
  gridSideCol: { flex: 1, gap: 10 },
  gridSideCell: { flex: 1 },
  gridStripRow: { flexDirection: 'row', gap: 10, height: 88 },
  gridStripCell: { flex: 1 },
  gridCell: { borderRadius: 14, overflow: 'hidden', position: 'relative' },
  gridEmpty: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#D8D2C6', backgroundColor: '#FBF9F4', alignItems: 'center', justifyContent: 'center', gap: 2 },
  gridEmptyPlus: { fontSize: 20, color: '#C6BFB2', fontWeight: '300' },
  gridEmptyLabel: { fontSize: 10.5, color: '#A39C92', textTransform: 'capitalize', letterSpacing: 0.6 },
  cellTag: { position: 'absolute', left: 6, right: 6, bottom: 6, backgroundColor: 'rgba(250,248,244,0.92)', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 },
  cellTagText: { fontSize: 10, fontWeight: '600', color: '#3B3833', letterSpacing: 0.2 },
  trySub: { fontSize: 12.5, color: '#8A8580', marginTop: 2, marginBottom: 14 },
  tryRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEE9E0', borderRadius: 14, padding: 14, marginBottom: 8 },
  tryRowGlyph: { fontSize: 22 },
  tryThumb: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#EEE9E0' },
  tryRowTitle: { fontSize: 14.5, fontWeight: '700', color: '#17161A' },
  tryRowSub: { fontSize: 11.5, color: '#8A8580', marginTop: 1 },
  tryChange: { fontSize: 12.5, fontWeight: '700', color: '#54504A', textAlign: 'center', paddingVertical: 8 },
  gridFill: { width: '100%', height: '100%' },
  gridVizCell: { backgroundColor: '#17161A', alignItems: 'center', justifyContent: 'center', gap: 3 },
  gridVizGlyph: { fontSize: 18 },
  gridVizLabel: { color: '#E8C877', fontSize: 10.5, letterSpacing: 1.6, textTransform: 'uppercase', fontWeight: '700' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  vizBlock: { marginBottom: 16 },
  vizBtn: { alignItems: 'center' },
  vizCard: {
    borderRadius: 18, backgroundColor: '#F3EFE7', borderWidth: 1, borderColor: '#EAE4D8',
    padding: 10, alignItems: 'center', gap: 8,
  },
  vizGenGlyph: { fontSize: 26, marginTop: 18 },
  vizGenText: { fontSize: 13.5, fontWeight: '600', color: '#54504A', textAlign: 'center' },
  vizGenSub: { fontSize: 11.5, color: '#A39C92', marginBottom: 18 },
  vizImage: { width: '100%', aspectRatio: 2 / 3, borderRadius: 12 },
  vizActions: { flexDirection: 'row', gap: 22, paddingVertical: 4 },
  vizActionText: { fontSize: 12.5, fontWeight: '700', color: '#54504A' },
  paletteBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#fff', borderWidth: 1, borderColor: '#EEE9E0', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  paletteDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
  paletteClear: { fontSize: 10.5, color: '#8A8580', fontWeight: '600' },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 1.6, color: '#8A8580', textTransform: 'uppercase', marginBottom: 10, marginTop: 8 },
  lookFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 6 },
  lookCount: { fontSize: 12, fontWeight: '600', color: '#8A8580', letterSpacing: 1.2, textTransform: 'uppercase' },
  rowGap: { flexDirection: 'row', gap: 8 },
  btn: { backgroundColor: '#17161A', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 999 },
  btnWide: { alignItems: 'center', marginTop: 14 },
  btnText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#17161A' },
  btnGhostText: { color: '#17161A', fontSize: 13.5, fontWeight: '700' },

  savedLook: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#EEE9E0', padding: 10, marginBottom: 8 },
  savedSwatches: { flexDirection: 'row', gap: 3 },
  miniSwatch: { width: 30, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  miniGlyph: { fontSize: 15 },
  savedName: { fontSize: 13.5, fontWeight: '700', color: '#17161A' },
  savedMeta: { fontSize: 11.5, color: '#8A8580', marginTop: 1 },
  savedOpen: { fontSize: 12.5, fontWeight: '700', color: '#17161A' },
  orderRow: { backgroundColor: '#F1EEE7', borderRadius: 12, padding: 12, marginBottom: 8 },

  tabBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', backgroundColor: '#fff',
    borderTopWidth: 1, borderTopColor: '#EEE9E0', paddingBottom: Platform.OS === 'web' ? 10 : 22, paddingTop: 10,
  },
  tabBtn: { flex: 1, alignItems: 'center' },
  tabText: { fontSize: 13, fontWeight: '600', color: '#A39C92' },
  tabTextOn: { color: '#17161A' },
  agentTab: { color: '#8A6D1F' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(20,18,15,0.35)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FAF8F4', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 30, width: '100%', maxWidth: 402, alignSelf: 'center' },
  sheetTall: { height: '75%' },
  sheetSwatch: { width: '68%', alignSelf: 'center', aspectRatio: 0.8, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sheetGlyph: { fontSize: 64 },
  sheetName: { fontSize: 19, fontWeight: '800', color: '#17161A', marginTop: 12 },
  sheetPrice: { fontSize: 15, color: '#54504A', marginTop: 2 },
  colorwayRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  colorwayDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: 'transparent' },
  colorwayDotOn: { borderColor: '#17161A' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  tag: { fontSize: 11, color: '#54504A', backgroundColor: '#F1EEE7', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEE9E0' },
  pickThumb: { width: 44, height: 52, borderRadius: 8 },
  pickName: { fontSize: 13.5, fontWeight: '600', color: '#17161A' },
  pickClear: { fontSize: 13.5, fontWeight: '600', color: '#B4432F' },

  consoleSheet: { backgroundColor: '#17161A' },
  consoleTitle: { fontSize: 15, fontWeight: '800', color: '#E8C877', letterSpacing: 0.4 },
  consoleSub: { fontSize: 11.5, color: '#9C978F', marginTop: 3, marginBottom: 10 },
  quickRow: { maxHeight: 38, marginBottom: 10 },
  quickChip: { backgroundColor: '#2A2830', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, marginRight: 8 },
  quickChipText: { color: '#E7E3DB', fontSize: 12, fontWeight: '600' },
  consoleLog: { flex: 1, backgroundColor: '#100F13', borderRadius: 12 },
  consoleLogPad: { padding: 12 },
  consoleHint: { color: '#6E6A64', fontSize: 12, fontFamily: MONO, lineHeight: 18 },
  consoleLine: { fontSize: 11.5, fontFamily: MONO, lineHeight: 17, marginBottom: 6 },
  consoleIn: { color: '#E8C877' },
  consoleOut: { color: '#B9C7A8' },
  consoleInputRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  consoleInput: {
    flex: 1, backgroundColor: '#100F13', borderRadius: 10, color: '#E7E3DB', fontFamily: MONO, fontSize: 12.5,
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: '#2A2830',
  },
});
