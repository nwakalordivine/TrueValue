// Lucide outline icons as SVG strings, so they can go straight into the page templates.
// Only the icons imported here end up in the bundle. Sizes: 20px in navigation, 16px inline.
import {
  House, MessageCircle, Columns2, MapPin, Info, Menu, X, UserRound, LogIn, Flag, Handshake, PawPrint, Leaf,
  Package, Recycle, Warehouse, Coins, Trash, CircleQuestionMark, ExternalLink, Clock, Search, Camera, ImageUp,
  ScanLine, Check, ChevronLeft, ChevronRight, Plus, ShoppingCart, LocateFixed, TriangleExclamationPoint,
  Building, Sparkles, Send, CircleCheck, MessageSquareExclamationPoint, Store,
} from 'lucide';

const ICONS = {
  home: House, assistant: MessageCircle, compare: Columns2, pin: MapPin, info: Info, menu: Menu, close: X,
  user: UserRound, login: LogIn, flag: Flag, handshake: Handshake, paw: PawPrint, leaf: Leaf, package: Package,
  recycle: Recycle, depot: Warehouse, coins: Coins, trash: Trash, help: CircleQuestionMark, external: ExternalLink,
  clock: Clock, search: Search, camera: Camera, upload: ImageUp, scan: ScanLine, check: Check, back: ChevronLeft,
  next: ChevronRight, plus: Plus, cart: ShoppingCart, locate: LocateFixed, warning: TriangleExclamationPoint,
  building: Building, sparkles: Sparkles, send: Send, ok: CircleCheck, report: MessageSquareExclamationPoint,
  store: Store,
};

// One icon per value (replaces the emoji stored in ethicalDimensions.json)
export const DIMENSION_ICONS = {
  canadian_ownership: 'flag', local_business: 'pin', fair_trade: 'handshake', animal_welfare: 'paw',
  environment: 'leaf', packaging: 'package',
};
// One icon per City of Regina bin (replaces the emoji the backend sends)
export const BIN_ICONS = { blue_cart: 'recycle', sarcan: 'depot', sarcan_refund: 'coins', garbage: 'trash', check: 'help' };

const attr = attrs => Object.entries(attrs).map(([k, v]) => `${k}="${String(v).replace(/"/g, '&quot;')}"`).join(' ');

export function icon(name, size = 16, label = '') {
  const node = ICONS[name];
  if (!node) return '';
  const a11y = label ? `role="img" aria-label="${label.replace(/"/g, '&quot;')}"` : 'aria-hidden="true" focusable="false"';
  const children = node.map(([tag, attrs]) => `<${tag} ${attr(attrs)}/>`).join('');
  return `<svg class="icon" xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${a11y}>${children}</svg>`;
}
