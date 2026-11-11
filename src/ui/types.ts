/** Only the current player's server-filtered projection crosses into React.
 * No authority object, token, deck order or random stream belongs in this model. */
export type Resource = "wood" | "brick" | "sheep" | "wheat" | "ore";
export type Bundle = Record<Resource, number>;
export type Build = "road" | "settlement" | "city" | "development";
export type Phase =
  | "lobby"
  | "setup-settlement"
  | "setup-road"
  | "roll"
  | "action"
  | "discard"
  | "robber"
  | "steal"
  | "road-building"
  | "finished";
export interface Options {
  friendlyRobber?: boolean;
  harbormaster?: boolean;
  playerExpansion?: "base" | "five-six-2025";
}
export interface Development {
  id: string;
  type: "knight" | "roadBuilding" | "plenty" | "monopoly" | "victory";
  bought: number;
}
export interface PlayerView {
  id: string;
  name: string;
  color: string;
  bot: boolean;
  online: boolean;
  ready?: boolean;
  nicknameBadge?: number;
  cards: number;
  developmentCount: number;
  points: number;
  knights?: number;
  roadLength?: number;
  harborPoints?: number;
  hand?: Bundle;
  dev?: Development[];
}
export interface BoardView {
  vertices: {
    id: number;
    x: number;
    z: number;
    owner: string | null;
    level: number;
  }[];
  edges: { id: number; a: number; b: number; owner: string | null }[];
  ports: { id: number; resource: Resource | "any"; vertices: number[] }[];
  tiles: {
    id: number;
    resource: Resource | "desert";
    number: number | null;
    vertices: number[];
    x: number;
    z: number;
  }[];
}
export interface GameView {
  phase: Phase;
  me: string;
  players: PlayerView[];
  options: Options;
  board: BoardView | null;
  turn: number;
  turnNo: number;
  pairStep: "primary" | "secondary";
  targetPoints: number;
  bank: Bundle;
  dice: number[] | null;
  discards: Record<string, number>;
  playedDev: boolean;
  freeRoads: number;
  deckCount: number;
  winner: string | null;
  longest: string | null;
  army: string | null;
  harbormaster: string | null;
  offer: { id: string; from: string; give: Bundle; want: Bundle } | null;
  legal: {
    settlement: number[];
    road: number[];
    city: number[];
    robber: number[];
    victims: string[];
  };
  profile?: { resourceCount: number; minPlayers: number; maxPlayers: number };
  room?: {
    hostId: string;
    visibility: string;
    practice: boolean;
    paused: boolean;
    expiresAt?: number;
    serverNow?: number;
    retentionReason?: string;
  };
  log: { text: string }[];
  chat: { id: string; name: string; text: string; sentAt: number }[];
}
export interface PublicRoom {
  code: string;
  phase: Phase;
  status: string;
  playerCount: number;
  maxPlayers: number;
  hostName: string;
  options: Options;
}
export interface Task {
  key: string;
  title: string;
  description: string;
}
export interface UIModel {
  state: GameView | null;
  domestic: boolean;
  backendId: string;
  code: string;
  publicCode: string;
  status: string;
  statusText: string;
  busy: boolean;
  isHost: boolean;
  myTurn: boolean;
  selectedBuild: Build | "";
  inspectedBuild: Build | "";
  panel: string;
  cardId: string;
  stagePanel: string;
  stageTitle: string;
  focusedPlayer: string;
  selectedPort: number | null;
  tradeView: string;
  tradePage: string;
  draft: Map<string, string | boolean>;
  flat: boolean;
  autoFollow: boolean;
  followPaused: boolean;
  reducedMotion: boolean;
  unreadChat: number;
  chatBusy: boolean;
  task: Task | null;
  entryError: string;
  terminalMessage: string;
  nickname: { id: string; name: string } | null;
  name: string;
  invite: string;
  last: { code: string } | null;
  returnableRooms: string[];
  lobbyURL: string | null;
  roomList: {
    status: string;
    rooms: PublicRoom[];
    error: string;
    nextCursor: string | null;
    moreStatus: string;
    moreError: string;
  };
  receivedAt: number;
  reportInfo: {
    failed?: boolean;
    contact?: string;
    chatLimit?: number;
    chatDays?: number;
    retentionDays?: number;
    adminReady?: boolean;
  } | null;
  reportContext: string;
  confirmation: {
    title: string;
    description: string;
    confirmText: string;
    chooseTransfer?: boolean;
  } | null;
  homeMotion: {
    hidden: boolean;
    disabled: boolean;
    label: string;
    glyph: string;
    playing: boolean;
  };
  practiceOptions: Options;
  practiceCount: number;
}
export type RoomModel = UIModel & { state: GameView };
export const ownPlayer = (s: GameView) =>
  s.players.find((p) => p.id === s.me)! as PlayerView & {
    hand: Bundle;
    dev: Development[];
  };
