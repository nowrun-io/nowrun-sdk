// Drape — gender-fluid essentials. Product catalogue.
// Every piece is unisex; sizing is one ladder (XXS–XXL); no gender field anywhere.
// Visuals: ghost-mannequin product PNGs (Magnific), generated into a fixed pose
// template so pieces layer into one composed look. Until an item's `image`
// lands, the app renders its swatch + glyph placeholder.
// This file IS the demo thesis: the app describes itself to the agent.

export type Slot = 'top' | 'bottom' | 'dress' | 'outerwear' | 'shoes' | 'accessory';

export type Collection = 'essentials' | 'coast' | 'alpine' | 'festive';

export interface Sku {
  id: string;
  name: string;
  slot: Slot;
  collection: Collection;
  price: number; // USD
  color: string; // base colour: swatch placeholder + palette logic
  colorGroup?: string; // SKUs sharing a base garment (colorways)
  tone: 'warm' | 'cool' | 'neutral';
  tintable?: boolean; // accepts live palette/hex tint (multiply overlay on the ghost PNG)
  tags: string[];
  glyph: string; // placeholder glyph until real imagery lands
  image?: string; // ghost-mannequin product PNG (generated)
}

export const COLLECTIONS: { key: Collection | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'essentials', label: 'Essentials' },
  { key: 'coast', label: 'Coast' },
  { key: 'alpine', label: 'Alpine' },
  { key: 'festive', label: 'Festive' },
];

export const SLOTS: Slot[] = ['outerwear', 'top', 'bottom', 'dress', 'shoes', 'accessory'];

export const CATALOG: Sku[] = [
  // ——— Tops ———
  { id: 'top_01', name: 'Relaxed Oxford Shirt', slot: 'top', collection: 'essentials', price: 58, color: '#F5F2EA', tone: 'neutral', tintable: true, glyph: '👔', tags: ['work', 'formal', 'casual', 'breathable', 'summer', 'wedding'] },
  { id: 'top_02a', name: 'Boxy Tee — Navy', slot: 'top', collection: 'essentials', price: 26, color: '#2C3E5D', colorGroup: 'boxy_tee', tone: 'cool', tintable: true, glyph: '👕', tags: ['casual', 'summer', 'breathable'] },
  { id: 'top_02b', name: 'Boxy Tee — Ecru', slot: 'top', collection: 'essentials', price: 26, color: '#EFE6D8', colorGroup: 'boxy_tee', tone: 'warm', tintable: true, glyph: '👕', tags: ['casual', 'summer', 'breathable'] },
  { id: 'top_02c', name: 'Boxy Tee — Olive', slot: 'top', collection: 'essentials', price: 26, color: '#6B7A5A', colorGroup: 'boxy_tee', tone: 'warm', tintable: true, glyph: '👕', tags: ['casual', 'summer', 'breathable'] },
  { id: 'top_03', name: 'Collarless Linen Shirt', slot: 'top', collection: 'essentials', price: 64, color: '#F0E9DA', tone: 'warm', tintable: true, glyph: '👕', tags: ['breathable', 'casual', 'rainy-ok', 'summer', 'wedding', 'beach'] },
  { id: 'top_04', name: 'Merino Turtleneck', slot: 'top', collection: 'essentials', price: 72, color: '#1E1E22', tone: 'cool', tintable: true, glyph: '🖤', tags: ['work', 'formal', 'winter', 'party', 'evening'] },
  { id: 'top_05', name: 'Fluid Sateen Shirt', slot: 'top', collection: 'essentials', price: 96, color: '#B7C4B1', tone: 'cool', tintable: true, glyph: '👚', tags: ['formal', 'wedding', 'party', 'evening', 'breathable'] },
  { id: 'top_06', name: 'Heavy Flannel Overshirt', slot: 'top', collection: 'essentials', price: 78, color: '#7A5C48', tone: 'warm', tintable: true, glyph: '🧶', tags: ['casual', 'winter', 'work'] },

  // ——— Bottoms ———
  { id: 'bot_01a', name: 'Straight Denim — Indigo', slot: 'bottom', collection: 'essentials', price: 74, color: '#3A4A6B', colorGroup: 'straight_denim', tone: 'cool', glyph: '👖', tags: ['casual', 'work'] },
  { id: 'bot_01b', name: 'Straight Denim — Washed', slot: 'bottom', collection: 'essentials', price: 74, color: '#8FA3C0', colorGroup: 'straight_denim', tone: 'cool', glyph: '👖', tags: ['casual', 'summer'] },
  { id: 'bot_02', name: 'Wide Wool Trousers', slot: 'bottom', collection: 'essentials', price: 92, color: '#3C3C41', tone: 'cool', tintable: true, glyph: '👖', tags: ['work', 'formal', 'evening', 'wedding', 'winter'] },
  { id: 'bot_03', name: 'Garment-Dyed Chinos', slot: 'bottom', collection: 'essentials', price: 62, color: '#D8C6A5', tone: 'warm', tintable: true, glyph: '👖', tags: ['casual', 'work', 'summer', 'breathable'] },
  { id: 'bot_04', name: 'Pleated Midi Skirt', slot: 'bottom', collection: 'essentials', price: 78, color: '#C9A88F', tone: 'warm', tintable: true, glyph: '🩳', tags: ['formal', 'wedding', 'party', 'summer', 'breathable'] },
  { id: 'bot_05', name: 'Drawstring Shorts', slot: 'bottom', collection: 'essentials', price: 44, color: '#9AA48E', tone: 'warm', tintable: true, glyph: '🩳', tags: ['casual', 'summer', 'beach', 'breathable'] },

  // ——— Dresses (occupy top + bottom) ———
  { id: 'drs_01', name: 'A-Line Midi Dress', slot: 'dress', collection: 'essentials', price: 118, color: '#D9A7A0', tone: 'warm', tintable: true, glyph: '👗', tags: ['wedding', 'party', 'summer', 'breathable', 'beach'] },
  { id: 'drs_02', name: 'Bias-Cut Slip Dress', slot: 'dress', collection: 'essentials', price: 104, color: '#232028', tone: 'cool', tintable: true, glyph: '👗', tags: ['party', 'evening', 'formal', 'wedding'] },

  // ——— Outerwear ———
  { id: 'out_01', name: 'Oversized Wool Overcoat', slot: 'outerwear', collection: 'essentials', price: 210, color: '#C19A6B', tone: 'warm', tintable: true, glyph: '🧥', tags: ['winter', 'work', 'formal', 'evening'] },
  { id: 'out_02', name: 'Hooded Rain Shell', slot: 'outerwear', collection: 'essentials', price: 132, color: '#26282E', tone: 'cool', glyph: '🧥', tags: ['rainy-ok', 'casual', 'work', 'monsoon'] },
  { id: 'out_03', name: 'Washed Denim Jacket', slot: 'outerwear', collection: 'essentials', price: 98, color: '#4A5C7D', tone: 'cool', glyph: '🧥', tags: ['casual', 'summer', 'party'] },
  { id: 'out_04', name: 'Belted Trench Coat', slot: 'outerwear', collection: 'essentials', price: 178, color: '#D5C3A1', tone: 'warm', tintable: true, glyph: '🧥', tags: ['rainy-ok', 'work', 'formal', 'monsoon', 'wedding'] },
  { id: 'out_05', name: 'Padded Bomber', slot: 'outerwear', collection: 'essentials', price: 148, color: '#4E4A42', tone: 'warm', tintable: true, glyph: '🧥', tags: ['casual', 'winter', 'party'] },

  // ——— Shoes ———
  { id: 'sho_01', name: 'Court Sneakers', slot: 'shoes', collection: 'essentials', price: 88, color: '#F2F0EB', tone: 'neutral', tintable: true, glyph: '👟', tags: ['casual', 'summer', 'work'] },
  { id: 'sho_02', name: 'Leather Derbies', slot: 'shoes', collection: 'essentials', price: 124, color: '#211F24', tone: 'cool', glyph: '👞', tags: ['formal', 'work', 'wedding', 'evening', 'rainy-ok'] },
  { id: 'sho_03', name: 'Suede Loafers', slot: 'shoes', collection: 'essentials', price: 110, color: '#B4834E', tone: 'warm', glyph: '👞', tags: ['work', 'casual', 'wedding', 'summer'] },
  { id: 'sho_04', name: 'Chelsea Boots', slot: 'shoes', collection: 'essentials', price: 136, color: '#2E3230', tone: 'cool', glyph: '🥾', tags: ['rainy-ok', 'monsoon', 'winter', 'casual', 'evening'] },

  // ——— Accessories ———
  { id: 'acc_01', name: 'Canvas Tote', slot: 'accessory', collection: 'essentials', price: 42, color: '#E4DCC8', tone: 'warm', tintable: true, glyph: '👜', tags: ['casual', 'work', 'summer', 'beach'] },
  { id: 'acc_02', name: 'Minimal Steel Watch', slot: 'accessory', collection: 'essentials', price: 149, color: '#B9BDC4', tone: 'cool', glyph: '⌚', tags: ['work', 'formal', 'evening', 'wedding'] },
  { id: 'acc_03', name: 'Brushed Wool Scarf', slot: 'accessory', collection: 'essentials', price: 54, color: '#C1683C', tone: 'warm', tintable: true, glyph: '🧣', tags: ['winter', 'casual'] },
  { id: 'acc_04', name: 'Compact Umbrella', slot: 'accessory', collection: 'essentials', price: 28, color: '#37455C', tone: 'cool', glyph: '☂️', tags: ['rainy-ok', 'monsoon'] },
  { id: 'acc_05', name: 'Six-Panel Cap', slot: 'accessory', collection: 'essentials', price: 36, color: '#3E4A3D', tone: 'cool', tintable: true, glyph: '🧢', tags: ['casual', 'summer', 'beach'] },

  // ═══ COAST — beach & resort ═══
  { id: 'cst_01', name: 'Camp-Collar Linen Shirt', slot: 'top', collection: 'coast', price: 68, color: '#EAD9B8', tone: 'warm', tintable: true, glyph: '🌴', tags: ['beach', 'resort', 'summer', 'breathable', 'casual', 'party'] },
  { id: 'cst_02', name: 'Towelling Terry Polo', slot: 'top', collection: 'coast', price: 54, color: '#D9C7A4', tone: 'warm', tintable: true, glyph: '👕', tags: ['beach', 'resort', 'summer', 'casual'] },
  { id: 'cst_03', name: 'Crochet Knit Tank', slot: 'top', collection: 'coast', price: 48, color: '#E8DCC4', tone: 'warm', tintable: true, glyph: '🧶', tags: ['beach', 'resort', 'summer', 'party', 'breathable'] },
  { id: 'cst_04', name: 'Recycled Swim Shorts', slot: 'bottom', collection: 'coast', price: 46, color: '#3E6E75', tone: 'cool', tintable: true, glyph: '🩳', tags: ['beach', 'swim', 'summer', 'resort'] },
  { id: 'cst_05', name: 'Linen Wide-Leg Pants', slot: 'bottom', collection: 'coast', price: 72, color: '#F0E7D4', tone: 'warm', tintable: true, glyph: '👖', tags: ['beach', 'resort', 'summer', 'breathable', 'wedding', 'casual'] },
  { id: 'cst_06', name: 'Sarong Wrap', slot: 'bottom', collection: 'coast', price: 38, color: '#C77E5A', tone: 'warm', tintable: true, glyph: '🏖️', tags: ['beach', 'swim', 'resort', 'summer'] },
  { id: 'cst_07', name: 'Leather Slide Sandals', slot: 'shoes', collection: 'coast', price: 64, color: '#A97C50', tone: 'warm', glyph: '🩴', tags: ['beach', 'resort', 'summer', 'casual'] },
  { id: 'cst_08', name: 'Woven Straw Tote', slot: 'accessory', collection: 'coast', price: 52, color: '#D8BE8C', tone: 'warm', glyph: '🧺', tags: ['beach', 'resort', 'summer'] },
  { id: 'cst_09', name: 'Cotton Bucket Hat', slot: 'accessory', collection: 'coast', price: 34, color: '#EFE8D6', tone: 'neutral', tintable: true, glyph: '👒', tags: ['beach', 'resort', 'summer', 'casual'] },
  { id: 'cst_10', name: 'Acetate Sunglasses', slot: 'accessory', collection: 'coast', price: 88, color: '#2A2622', tone: 'cool', glyph: '🕶️', tags: ['beach', 'resort', 'summer', 'party'] },

  // ═══ ALPINE — mountain & trek ═══
  { id: 'alp_01', name: 'Fleece Half-Zip', slot: 'top', collection: 'alpine', price: 84, color: '#8D8A7E', tone: 'neutral', tintable: true, glyph: '🏔️', tags: ['trek', 'mountain', 'winter', 'casual', 'thermal'] },
  { id: 'alp_02', name: 'Merino Base Layer', slot: 'top', collection: 'alpine', price: 66, color: '#48413C', tone: 'warm', tintable: true, glyph: '🥾', tags: ['trek', 'mountain', 'thermal', 'winter', 'snow'] },
  { id: 'alp_03', name: 'Waffle-Knit Midlayer', slot: 'top', collection: 'alpine', price: 78, color: '#6E5F4B', tone: 'warm', tintable: true, glyph: '🧶', tags: ['trek', 'mountain', 'winter', 'casual'] },
  { id: 'alp_04', name: 'Technical Cargo Pants', slot: 'bottom', collection: 'alpine', price: 96, color: '#55584C', tone: 'cool', tintable: true, glyph: '👖', tags: ['trek', 'mountain', 'casual', 'rainy-ok'] },
  { id: 'alp_05', name: 'Shell Over-Trousers', slot: 'bottom', collection: 'alpine', price: 88, color: '#2B2E33', tone: 'cool', glyph: '👖', tags: ['trek', 'mountain', 'snow', 'rainy-ok', 'monsoon'] },
  { id: 'alp_06', name: 'Down Puffer Jacket', slot: 'outerwear', collection: 'alpine', price: 188, color: '#43503F', tone: 'cool', tintable: true, glyph: '🧥', tags: ['mountain', 'snow', 'winter', 'thermal', 'trek'] },
  { id: 'alp_07', name: 'Softshell Parka', slot: 'outerwear', collection: 'alpine', price: 164, color: '#7A6A55', tone: 'warm', tintable: true, glyph: '🧥', tags: ['mountain', 'trek', 'winter', 'rainy-ok', 'work'] },
  { id: 'alp_08', name: 'Leather Hiking Boots', slot: 'shoes', collection: 'alpine', price: 172, color: '#6B4E33', tone: 'warm', glyph: '🥾', tags: ['trek', 'mountain', 'snow', 'winter', 'rainy-ok'] },
  { id: 'alp_09', name: 'Trail Runners', slot: 'shoes', collection: 'alpine', price: 128, color: '#5C6258', tone: 'cool', tintable: true, glyph: '👟', tags: ['trek', 'mountain', 'casual', 'summer'] },
  { id: 'alp_10', name: 'Ribbed Wool Beanie', slot: 'accessory', collection: 'alpine', price: 32, color: '#7C4A38', tone: 'warm', tintable: true, glyph: '🧢', tags: ['mountain', 'snow', 'winter', 'trek', 'casual'] },
  { id: 'alp_11', name: 'Insulated Gloves', slot: 'accessory', collection: 'alpine', price: 44, color: '#33302B', tone: 'cool', glyph: '🧤', tags: ['mountain', 'snow', 'winter', 'thermal'] },

  // ═══ FESTIVE — Indian occasionwear, all unisex ═══
  { id: 'fst_01a', name: 'Straight-Cut Kurta — Ivory', slot: 'top', collection: 'festive', price: 74, color: '#F2ECDC', colorGroup: 'kurta', tone: 'warm', tintable: true, glyph: '🪔', tags: ['festive', 'wedding', 'sangeet', 'diwali', 'breathable', 'summer'] },
  { id: 'fst_01b', name: 'Straight-Cut Kurta — Deep Teal', slot: 'top', collection: 'festive', price: 74, color: '#1F5457', colorGroup: 'kurta', tone: 'cool', tintable: true, glyph: '🪔', tags: ['festive', 'wedding', 'sangeet', 'diwali', 'evening'] },
  { id: 'fst_02', name: 'Silk Festive Kurta', slot: 'top', collection: 'festive', price: 118, color: '#8C2F39', tone: 'warm', tintable: true, glyph: '✨', tags: ['festive', 'wedding', 'sangeet', 'diwali', 'evening', 'formal'] },
  { id: 'fst_03', name: 'Brocade Waistcoat', slot: 'outerwear', collection: 'festive', price: 96, color: '#A8894C', tone: 'warm', glyph: '🧵', tags: ['festive', 'wedding', 'sangeet', 'formal', 'evening'] },
  { id: 'fst_04', name: 'Bandhgala Jacket', slot: 'outerwear', collection: 'festive', price: 186, color: '#2E2A3D', tone: 'cool', tintable: true, glyph: '🎩', tags: ['festive', 'wedding', 'formal', 'evening'] },
  { id: 'fst_05', name: 'Nehru Jacket', slot: 'outerwear', collection: 'festive', price: 124, color: '#6E4F3A', tone: 'warm', tintable: true, glyph: '🧥', tags: ['festive', 'wedding', 'diwali', 'formal', 'work'] },
  { id: 'fst_06', name: 'Dhoti Pants', slot: 'bottom', collection: 'festive', price: 62, color: '#EFE9D8', tone: 'warm', tintable: true, glyph: '👖', tags: ['festive', 'wedding', 'sangeet', 'diwali', 'breathable'] },
  { id: 'fst_07', name: 'Churidar', slot: 'bottom', collection: 'festive', price: 48, color: '#F4F0E4', tone: 'neutral', tintable: true, glyph: '👖', tags: ['festive', 'wedding', 'diwali', 'breathable'] },
  { id: 'fst_08', name: 'Embroidered Stole', slot: 'accessory', collection: 'festive', price: 58, color: '#B4433A', tone: 'warm', tintable: true, glyph: '🧣', tags: ['festive', 'wedding', 'sangeet', 'diwali', 'evening'] },
  { id: 'fst_09a', name: 'Embroidered Juttis — Tan', slot: 'shoes', collection: 'festive', price: 78, color: '#B58452', colorGroup: 'juttis', tone: 'warm', glyph: '🥿', tags: ['festive', 'wedding', 'sangeet', 'diwali'] },
  { id: 'fst_09b', name: 'Embroidered Juttis — Ivory', slot: 'shoes', collection: 'festive', price: 78, color: '#EDE5D2', colorGroup: 'juttis', tone: 'warm', glyph: '🥿', tags: ['festive', 'wedding', 'sangeet'] },
  { id: 'fst_10', name: 'Kolhapuri Sandals', slot: 'shoes', collection: 'festive', price: 56, color: '#8F5B36', tone: 'warm', glyph: '🩴', tags: ['festive', 'casual', 'summer', 'diwali', 'breathable'] },
];

export const byId = (id: string): Sku | undefined => CATALOG.find((s) => s.id === id);

export const CATEGORIES: { key: Slot | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'top', label: 'Tops' },
  { key: 'bottom', label: 'Bottoms' },
  { key: 'dress', label: 'Dresses' },
  { key: 'outerwear', label: 'Outerwear' },
  { key: 'shoes', label: 'Shoes' },
  { key: 'accessory', label: 'Accessories' },
];
