import { QualityChoice } from "./quality";
import { RESOURCES, LABELS, total } from "../../shared/board.js";
import { COSTS, DEV_NAMES } from "../../shared/game.js";
import { buildAvailability } from "../commerce.js";
import { portOwners } from "../ports.js";
import { rulesLabel, remainingTime } from "../room-ui.js";
import { Icon, Button, ResourceArt, Die, playerStyle } from "./primitives";
import {
  ownPlayer,
  type Build,
  type Resource,
  type RoomModel,
  type UIModel,
} from "./types";
import { PlayerDetail, PlayerList, RoomSettings, ResultPanel } from "./entry";
import { TradePanel, CostPanel } from "./commerce";

const resources = RESOURCES as Resource[];
const buildNames: Record<Build, string> = {
  road: "道路",
  settlement: "村庄",
  city: "城市",
  development: "发展卡",
};
export function CameraControls({ model: m }: { model: UIModel }) {
  return (
    <>
      <Button
        id="camera-overview"
        action="overview"
        className="camera-overview"
        aria-label="回到全局"
        title="回到全局"
      >
        <Icon name="focus" />
        <span>全局</span>
      </Button>
      <Button
        id="camera-follow"
        action="toggleFollow"
        aria-pressed={m.autoFollow && !m.followPaused}
        aria-label={
          !m.autoFollow
            ? "开启自动跟随"
            : m.followPaused
              ? "恢复自动跟随"
              : "暂停自动跟随"
        }
        title="拖动、缩放会暂停跟随"
      >
        <Icon name={m.autoFollow && !m.followPaused ? "follow" : "pause"} />
        <span>
          {!m.autoFollow ? "跟随关" : m.followPaused ? "手动" : "跟随中"}
        </span>
      </Button>
    </>
  );
}
export function StageTools({ model: m }: { model: RoomModel }) {
  const canPause = m.isHost && m.state.board && m.state.phase !== "finished";
  return (
    <>
      <div className="stage-primary">
        <a
          className="stage-brand"
          data-home-link=""
          href="/"
          aria-label="卡坦岛好友桌首页"
          title="卡坦岛"
        >
          <Icon name="island" />
        </a>
        <div
          id="camera-toolbar"
          role="group"
          aria-label="棋盘视角"
          data-follow-state={
            !m.autoFollow ? "off" : m.followPaused ? "manual" : "following"
          }
        >
          <CameraControls model={m} />
        </div>
      </div>
      <div className="stage-utilities">
        {canPause && (
          <Button
            action={m.state.room?.paused ? "resumeGame" : "pauseGame"}
            className={`pause-control ${m.state.room?.paused ? "is-paused" : ""}`}
            aria-label={m.state.room?.paused ? "恢复对局" : "暂停对局"}
            title={m.state.room?.paused ? "恢复对局" : "暂停对局"}
            disabled={m.busy || m.status !== "connected"}
          >
            <Icon name={m.state.room?.paused ? "play" : "pause"} />
          </Button>
        )}
        {[
          ...(!m.domestic ? [["chat", "openChat", "聊天"]] : []),
          ["log", "openLog", "记录"],
          ["settings", "openSettings", "设置"],
        ].map(([glyph, action, label]) => (
          <Button
            key={action}
            action={action}
            aria-label={label}
            title={label}
            aria-haspopup="dialog"
          >
            <Icon name={glyph} />
            {action === "openChat" && m.unreadChat > 0 && (
              <span className="chat-unread badge">{m.unreadChat}</span>
            )}
          </Button>
        ))}
      </div>
    </>
  );
}
export function GameControls({ model: m }: { model: RoomModel }) {
  const s = m.state,
    disabled = m.busy || m.status !== "connected" || s.room?.paused;
  if (m.inspectedBuild) return <CostPanel model={m} kind={m.inspectedBuild} />;
  return (
    <>
      <section className="build-section" aria-label="建造">
        {(Object.keys(buildNames) as Build[]).map((k) => {
          const cost = Object.entries(COSTS[k])
            .map(([r, n]) => `${LABELS[r as Resource]} ${n}`)
            .join("，");
          return (
            <button
              key={k}
              type="button"
              className={`build-button ${m.selectedBuild === k ? "selected" : ""}`}
              data-build={m.selectedBuild === k ? undefined : k}
              data-action={m.selectedBuild === k ? "closeCost" : undefined}
              aria-label={m.selectedBuild === k ? `取消${buildNames[k]}建造` : `建造${buildNames[k]}，${cost}`}
              aria-pressed={m.selectedBuild === k}
              title={`${buildNames[k]} · ${cost}`}
              aria-description={
                buildAvailability(s, k).reason || "点击查看费用"
              }
            >
              <Icon name={k} />
              <span>{m.selectedBuild === k ? `取消${buildNames[k]}` : buildNames[k]}</span>
            </button>
          );
        })}
      </section>
      <div className="turn-actions">
        <Button action="trade" className="secondary" aria-label="资源交易">
          <Icon name="trade" />
          <span>交易{s.offer ? " · 1" : ""}</span>
        </Button>
        {s.phase === "roll" && m.myTurn ? (
          <Button
            action="roll"
            className="primary"
            disabled={disabled}
            aria-label="掷出骰子"
          >
            <Icon name="dice" />
            <span>掷骰</span>
          </Button>
        ) : (
          <Button
            action="endTurn"
            className="primary"
            disabled={disabled || !m.myTurn || s.phase !== "action"}
          >
            <Icon name="arrow" />
            <span>{s.pairStep === "secondary" ? "结束阶段" : "结束回合"}</span>
          </Button>
        )}
      </div>
    </>
  );
}
export function Banner({ model: m }: { model: RoomModel }) {
  const s = m.state;
  if (s.phase === "lobby")
    return (
      <div className="waiting-banner">
        <strong>
          房间 {m.publicCode}{" "}
          <small>{s.room?.visibility === "private" ? "私密" : "公开"}</small>
        </strong>
        <span>
          {s.players.length} / 6 人 ·{" "}
          {s.players.length > 4 ? "5–6 人扩充 · 配对建设" : "基础版 · 3–4 人"}
        </span>
        <small>
          {s.players.length < 3
            ? `再来 ${3 - s.players.length} 人即可开局`
            : s.players.some(
                  (p) =>
                    !p.bot &&
                    p.id !== (s.room?.hostId || s.players[0]?.id) &&
                    (!p.ready || !p.online),
                )
              ? "等待朋友在线并准备"
              : "已就绪 · 房主可开始"}
          {s.options?.friendlyRobber ? " · 友善强盗" : ""}
          {s.options?.harbormaster ? " · 卡坦港口" : ""}
        </small>
      </div>
    );
  if (!s.board) return null;
  const p = s.players[s.turn],
    task = m.task;
  const descriptions: Record<string, string> = {
    "setup-settlement": "放置村庄",
    "setup-road": "铺设起始道路",
    roll: "等待掷骰",
    action: m.selectedBuild
      ? `选择${buildNames[m.selectedBuild]}位置`
      : s.pairStep === "secondary"
        ? "配对建设阶段"
        : "交易 · 建造",
    discard: "等待弃牌",
    robber: "选择强盗地块",
    steal: "选择被抢玩家",
    "road-building": `免费道路 · 还可建 ${s.freeRoads} 条`,
    finished: "对局结束",
  };
  const glyph =
    m.status !== "connected"
      ? "offline"
      : s.room?.paused
        ? "pause"
        : {
            "setup-settlement": "settlement",
            "setup-road": "road",
            roll: "dice",
            action: m.selectedBuild || "trade",
            discard: "cards",
            robber: "shield",
            steal: "cards",
            "road-building": "road",
            finished: "trophy",
          }[s.phase] || "island";
  return (
    <div
      className={`turn-banner ${m.myTurn ? "your-turn" : ""} ${task ? "needs-attention" : ""}`}
    >
      <span className="turn-dot" style={{ background: p.color }} />
      <div>
        <strong>
          {s.room?.paused
            ? "对局已暂停"
            : task
              ? task.title
              : s.phase === "finished"
                ? "对局结束"
                : m.myTurn
                  ? "你的回合"
                  : p.name}
        </strong>
        <span
          className={`turn-description ${m.status !== "connected" ? "connection-warning" : ""}`}
        >
          <Icon name={glyph} />
          {m.status !== "connected"
            ? m.statusText
            : s.room?.paused
              ? "电脑与操作已停止"
              : task
                ? "需要处理"
                : descriptions[s.phase] || ""}
        </span>
      </div>
      {s.room?.paused && m.isHost ? (
        <Button
          action="resumeGame"
          className="task-shortcut"
          disabled={m.busy || m.status !== "connected"}
        >
          恢复
        </Button>
      ) : task ? (
        <Button action="focusTask" className="task-shortcut">
          去处理
        </Button>
      ) : s.phase === "finished" ? (
        <Button action="openResult" className="task-shortcut">
          结算
        </Button>
      ) : (
        s.dice && (
          <div
            className="dice-pair"
            role="img"
            aria-label={`骰子 ${s.dice.join(" 加 ")}，合计 ${totalDice(s.dice)}`}
          >
            {s.dice.map((n, i) => (
              <Die key={i} value={n} />
            ))}
            <b>{totalDice(s.dice)}</b>
          </div>
        )
      )}
    </div>
  );
}
const totalDice = (dice: number[]) => dice.reduce((a, b) => a + b, 0);
export function Hand({ model: m }: { model: RoomModel }) {
  if (!m.state.board) return null;
  const me = ownPlayer(m.state);
  return (
    <div className="hand-tray" aria-label="你的资源与手牌">
      <div className="resource-hand">
        {resources.map((r) => (
          <div
            key={r}
            className={`resource-card ${r}`}
            role="img"
            aria-label={`${LABELS[r]} ${me.hand[r]} 张`}
            title={`${LABELS[r]}：${me.hand[r]} 张，银行剩余 ${m.state.bank[r]} 张`}
          >
            <span className="resource-art">
              <ResourceArt resource={r} />
            </span>
            <strong>{me.hand[r]}</strong>
          </div>
        ))}
        <Button
          action="openHand"
          className="hand-entry"
          aria-label={`你的手牌，${me.dev.length} 张发展卡`}
        >
          <Icon name="development" />
          <b>{me.dev.length}</b>
        </Button>
      </div>
    </div>
  );
}
function ResourceField({
  resource: r,
  prefix,
  max,
}: {
  resource: Resource;
  prefix: string;
  max: number;
}) {
  return (
    <label className={`resource-input ${r}`} htmlFor={`${prefix}-${r}`}>
      <span>
        <Icon name={r} />
        {LABELS[r]}
      </span>
      <input
        data-persist=""
        id={`${prefix}-${r}`}
        type="number"
        inputMode="numeric"
        min="0"
        max={max}
        defaultValue="0"
        aria-label={`${prefix === "discard" ? "弃掉" : "获取"}${LABELS[r]}数量`}
      />
    </label>
  );
}
export function ActionPanel({ model: m }: { model: RoomModel }) {
  const s = m.state,
    me = ownPlayer(s);
  if (s.room?.paused)
    return (
      <section className="choice-panel">
        <h2>对局已暂停</h2>
        <p>等待房主恢复对局。</p>
        {m.isHost && (
          <Button
            action="resumeGame"
            className="primary"
            disabled={m.busy || m.status !== "connected"}
          >
            恢复对局
          </Button>
        )}
      </section>
    );
  if (s.phase === "discard" && s.discards[s.me])
    return (
      <section className="choice-panel quantity-choice">
        <h2>弃掉 {s.discards[s.me]} 张资源</h2>
        <form id="discard-form" data-required-count={s.discards[s.me]}>
          <div className="quantity-fields">
            {resources.map((r) => (
              <ResourceField
                key={r}
                resource={r}
                prefix="discard"
                max={me.hand[r]}
              />
            ))}
          </div>
          <div className="decision-submit">
            <output className="quantity-summary" aria-live="polite">
              已选 0 / {s.discards[s.me]} 张
            </output>
            <button className="primary" disabled={m.busy}>
              确认弃牌
            </button>
          </div>
        </form>
      </section>
    );
  if (s.phase === "steal" && m.myTurn)
    return (
      <section className="choice-panel">
        <h2>选择一位对手</h2>
        <p>随机抽取对方的一张资源牌。</p>
        {s.legal.victims.map((id) => (
          <button key={id} className="secondary" data-victim={id}>
            {s.players.find((p) => p.id === id)?.name} <Icon name="arrow" />
          </button>
        ))}
      </section>
    );
  if (m.panel === "trade") return <TradePanel model={m} />;
  if (m.panel === "development" && m.cardId) {
    const card = me.dev.find((c) => c.id === m.cardId);
    if (!card) return null;
    return (
      <section
        className={`choice-panel ${card.type === "plenty" ? "quantity-choice" : ""}`}
      >
        <div className="panel-heading">
          <h2>{DEV_NAMES[card.type]}</h2>
          <Button
            action="closePanel"
            className="square"
            aria-label="关闭操作面板"
          >
            <Icon name="close" />
          </Button>
        </div>
        {card.type === "plenty" && <p>从银行选择共两张资源。</p>}
        <form
          id="development-form"
          data-required-count={card.type === "plenty" ? "2" : undefined}
        >
          {card.type === "plenty" ? (
            <div className="quantity-fields">
              {resources.map((r) => (
                <ResourceField
                  key={r}
                  resource={r}
                  prefix="plenty"
                  max={s.bank[r]}
                />
              ))}
            </div>
          ) : card.type === "monopoly" ? (
            <>
              <label htmlFor="monopoly-resource">
                收取所有对手的哪种资源？
              </label>
              <select id="monopoly-resource" data-persist="" defaultValue="ore">
                {resources.map((r) => (
                  <option key={r} value={r}>
                    {LABELS[r]}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <p>
              {card.type === "knight"
                ? "移动强盗，并从一位相邻对手手中抽一张资源。"
                : "免费铺设两条道路，仍需连接自己的路网。"}
            </p>
          )}
          <div className="decision-submit">
            {card.type === "plenty" && (
              <output className="quantity-summary" aria-live="polite">
                已选 0 / 2 张
              </output>
            )}
            <button className="primary" disabled={m.busy}>
              打出{DEV_NAMES[card.type]}
            </button>
          </div>
        </form>
      </section>
    );
  }
  return null;
}
function DevelopmentPanel({ model: m }: { model: RoomModel }) {
  const s = m.state,
    me = ownPlayer(s);
  if (!s.board) return null;
  return (
    <>
      <div className="development-hand">
        {me.dev.length ? (
          me.dev.map((c) => (
            <button
              key={c.id}
              data-card={c.id}
              disabled={
                m.busy ||
                s.room?.paused ||
                !m.myTurn ||
                !["roll", "action"].includes(s.phase) ||
                s.playedDev ||
                c.type === "victory" ||
                c.bought >= s.turnNo
              }
              title={
                c.type === "victory"
                  ? "私下自动计入胜利点"
                  : c.bought >= s.turnNo
                    ? "本回合购入，下回合可用"
                    : "打出这张发展卡"
              }
            >
              <Icon
                name={
                  {
                    knight: "knight",
                    roadBuilding: "road",
                    plenty: "wheat",
                    monopoly: "trade",
                    victory: "trophy",
                  }[c.type]
                }
              />
              <span>{DEV_NAMES[c.type]}</span>
              {c.bought >= s.turnNo && c.type !== "victory" && (
                <small>新</small>
              )}
            </button>
          ))
        ) : (
          <div className="hand-empty">
            <Icon name="development" />
            <p>暂无发展卡</p>
          </div>
        )}
      </div>
      <p className="small muted">资源 {total(me.hand)} 张 · 胜利点卡私下计分</p>
      <div className="piece-stock" aria-label="剩余棋子">
        {[
          [
            "road",
            15 - s.board.edges.filter((e) => e.owner === s.me).length,
            "道路",
          ],
          [
            "settlement",
            5 -
              s.board.vertices.filter((v) => v.owner === s.me && v.level === 1)
                .length,
            "村庄",
          ],
          [
            "city",
            4 -
              s.board.vertices.filter((v) => v.owner === s.me && v.level === 2)
                .length,
            "城市",
          ],
        ].map(([key, n, name]) => (
          <span key={key} aria-label={`剩余${name} ${n}`} title={`剩余${name}`}>
            <Icon name={String(key)} />
            <b>{n}</b>
            <small>{name}</small>
          </span>
        ))}
      </div>
      <div className="bank-stock" aria-label="银行资源">
        <small>银行</small>
        {resources.map((r) => (
          <span
            key={r}
            className={r}
            aria-label={`银行${LABELS[r]} ${s.bank[r]} 张`}
            title={`银行${LABELS[r]}`}
          >
            <Icon name={r} />
            <b>{s.bank[r]}</b>
          </span>
        ))}
      </div>
    </>
  );
}
export function ChatPanel({ model: m }: { model: RoomModel }) {
  return (
    <section className="chat-section">
      <div
        id="chat-messages"
        className="chat-log"
        role="log"
        aria-label="聊天记录"
      >
        {m.state.chat.length ? (
          m.state.chat.map((c) => (
            <p key={c.id} data-message-id={c.id} className="chat-bubble">
              <strong>{c.name}</strong>
              <span>{c.text}</span>
              <button
                type="button"
                className="chat-report"
                data-report-message={c.id}
                aria-label={`举报 ${c.name} 的消息`}
                title="举报消息"
              >
                <Icon name="flag" />
              </button>
            </p>
          ))
        ) : (
          <div className="chat-empty">
            <Icon name="chat" />
            <p>和朋友打声招呼。</p>
          </div>
        )}
      </div>
      <form id="chat-form">
        <input
          id="chat-message"
          data-persist=""
          maxLength={200}
          placeholder="说点什么…"
          aria-label="聊天消息"
        />
        <button
          className="square"
          aria-label="发送消息"
          disabled={m.chatBusy || m.status !== "connected"}
        >
          <Icon name="send" />
        </button>
      </form>
      <div className="chat-footer">
        <Button action="report" className="text-button">
          <Icon name="shield" />
          隐私 / 举报
        </Button>
      </div>
    </section>
  );
}
function Retention({ model: m }: { model: RoomModel }) {
  const room = m.state.room;
  if (!room) return null;
  const remaining = remainingTime(room.expiresAt, room.serverNow, m.receivedAt);
  return (
    <section
      className={`retention-notice ${remaining ? "has-deadline" : ""}`}
      role="status"
    >
      <strong>
        {room.paused
          ? "房主已暂停对局"
          : room.practice
            ? "个人练习房"
            : room.visibility === "private"
              ? "私密房间"
              : "公开房间"}
      </strong>
      <p id="room-retention">
        {remaining
          ? `${room.practice ? "练习房离线保留" : room.retentionReason === "paused" ? "本次暂停固定期限" : "房主离线保留"} · 剩余 ${remaining}，到期后房间关闭并清理。`
          : room.practice
            ? "练习房离线后保留 10 分钟，暂停不延长期限。"
            : room.paused
              ? "等待房主恢复。首次离线后固定保留最多 4 小时。"
              : "房主在线时保留房间；对局中断线可用原身份返回。"}
      </p>
    </section>
  );
}
function RoomNavigation({ model: m }: { model: RoomModel }) {
  const s = m.state;
  return (
    <div className="room-navigation">
      {m.isHost &&
        s.phase !== "lobby" &&
        s.phase !== "finished" &&
        !s.room?.paused && (
          <Button
            action="pauseGame"
            className="secondary"
            disabled={m.busy || m.status !== "connected"}
          >
            暂停对局
          </Button>
        )}
      {m.isHost &&
        s.phase !== "lobby" &&
        !s.room?.practice &&
        s.players.some((p) => p.id !== s.me && !p.bot && p.online) && (
          <Button
            action="transferMenu"
            className="text-button"
            disabled={m.busy}
          >
            转交房主
          </Button>
        )}
      <Button action="home" className="text-button" disabled={m.busy}>
        {s.phase === "lobby" && !m.isHost ? "退出座位" : "暂离房间"}
      </Button>
      {m.isHost && (
        <Button
          action="dissolve"
          className="danger-button"
          disabled={m.busy || m.status !== "connected"}
        >
          解散房间
        </Button>
      )}
    </div>
  );
}
function PortDetail({ model: m }: { model: RoomModel }) {
  const s = m.state,
    b = s.board,
    p = b?.ports.find((p) => p.id === m.selectedPort);
  if (!p || !b) return null;
  return (
    <section className="port-detail">
      {p.resource === "any" ? (
        <Icon name="harbor" />
      ) : (
        <ResourceArt resource={p.resource} />
      )}
      <h3>
        {p.resource === "any"
          ? "普通港口 · 3:1"
          : LABELS[p.resource] + "港口 · 2:1"}
      </h3>
      <div className="port-endpoints">
        {p.vertices.map((id) => {
          const v = b.vertices[id],
            owner = s.players.find((p) => p.id === v.owner);
          return (
            <span key={id} style={playerStyle(owner?.color || "#b7c4ad")}>
              <Icon name={v.level === 2 ? "city" : "settlement"} />
              落点 {id + 1}
              <br />
              {owner ? owner.name : "建造后可用"}
            </span>
          );
        })}
      </div>
      <p>
        {portOwners(b, p).includes(s.me)
          ? "你可使用此港口"
          : "任一端点建村庄或城市即可使用"}
      </p>
    </section>
  );
}
export function StageContent({ model: m }: { model: RoomModel }) {
  const s = m.state;
  const lobbyLink = m.lobbyURL && (
    <a className="settings-lobby" data-lobby-link="" href={m.lobbyURL}>
      返回游戏大厅 <Icon name="arrow" />
    </a>
  );
  if (m.stagePanel === "chat" && !m.domestic) return <ChatPanel model={m} />;
  if (m.stagePanel === "players")
    return s.phase === "lobby" ? (
      <>
        <p className="rules-summary">
          {s.players.length} / 6 人 · 电脑与真人均计入开局人数
        </p>
        <PlayerList model={m} />
      </>
    ) : (
      <PlayerDetail model={m} />
    );
  if (m.stagePanel === "log")
    return (
      <div className="activity-log" aria-label="岛屿记事">
        {s.log.map((l, i) => (
          <p key={i}>{l.text}</p>
        ))}
      </div>
    );
  if (m.stagePanel === "settings" && s.phase === "lobby")
    return (
      <>
        <RoomSettings model={m} />
        <Retention model={m} />
        <RoomNavigation model={m} />
        {lobbyLink}
      </>
    );
  if (m.stagePanel === "settings")
    return (
      <>
        <p className="settings-meta">
          <span className={`connection ${m.status}`}>
            <i />
            {m.statusText}
          </span>
          房间 {m.publicCode}
        </p>
        <Retention model={m} />
        <p className="rules-summary">
          {rulesLabel(s.options)} · {s.targetPoints || 10} 分获胜
        </p>
        <QualityChoice model={m} id="table-graphics-quality" />
        <fieldset className="action-preferences">
          <legend>行动与镜头</legend>
          <label>
            <input
              id="auto-follow"
              type="checkbox"
              defaultChecked={m.autoFollow}
            />
            <Icon name="follow" />
            自动跟随
          </label>
          <label>
            <input
              id="reduce-motion"
              type="checkbox"
              defaultChecked={m.reducedMotion}
            />
            <Icon name="pause" />
            减少动态
          </label>
          <details className="preference-help">
            <summary>镜头说明</summary>
            <p>
              拖动或缩放后，点「跟随」恢复。选择落点、输入或打开面板时保持视角。提示随地图位置显示；完整行动可在记录查看。
            </p>
          </details>
        </fieldset>
        <div className="settings-grid">
          {[
            ["zoom", "zoomIn", "放大"],
            ["minus", "zoomOut", "缩小"],
            ["reset", "reset", "复位"],
            ["", "toggleFlat", m.flat ? "3D 三维棋盘" : "2D 二维棋盘"],
            ["book", "rules", "玩法指南"],
            ["link", "invite", "邀请好友"],
          ].map(([glyph, action, label]) => (
            <Button
              key={action}
              action={action}
              aria-label={
                action === "toggleFlat"
                  ? m.flat
                    ? "切换三维棋盘"
                    : "切换二维棋盘"
                  : undefined
              }
            >
              {glyph && <Icon name={glyph} />} {label}
            </Button>
          ))}
        </div>
        {!m.domestic && (
          <Button action="report" className="text-button">
            <Icon name="shield" />
            隐私 / 举报
          </Button>
        )}
        <RoomNavigation model={m} />
        {m.lobbyURL && (
          <a className="settings-lobby" data-lobby-link="" href={m.lobbyURL}>
            返回游戏大厅 <Icon name="arrow" />
          </a>
        )}
      </>
    );
  if (m.stagePanel === "hand") return <DevelopmentPanel model={m} />;
  if (m.stagePanel === "port") return <PortDetail model={m} />;
  if (m.stagePanel === "result") return <ResultPanel model={m} />;
  return (
    <section id="decision-panel" tabIndex={-1} aria-label="当前操作">
      <ActionPanel model={m} />
    </section>
  );
}

