import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useSyncExternalStore } from "react";
import { COSTS } from "../../shared/game.js";
import { LABELS } from "../../shared/board.js";
import { Icon, Button } from "./primitives";
import {
  HomePanel,
  PublicRooms,
  OptionsFields,
  PlayerOrbit,
  LobbyControls,
} from "./entry";
import { StageTools, GameControls, Banner, Hand, StageContent } from "./table";
import { QualityChoice } from "./quality";
import type { UIModel, RoomModel, Resource, Build } from "./types";
import "./theme.css";

let snapshot: UIModel;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
function Interface() {
  const m = useSyncExternalStore(subscribe, () => snapshot),
    room = m as RoomModel,
    s = m.state;
  return (
    <>
      <header className="topbar">
        <a
          className="brand"
          data-home-link=""
          href="/"
          aria-label="卡坦岛好友桌首页"
        >
          <span className="brand-mark">
            <Icon name="island" />
          </span>
          <span>
            卡坦岛 <small>好友桌</small>
          </span>
        </a>
        <span className="entry-server">
          {
            { local: "本地", aliyun: "国内站", cloudflare: "海外站" }[
              m.backendId as "local" | "aliyun" | "cloudflare"
            ]
          }
        </span>
        <div id="room-meta">
          {m.code ? (
            <>
              <span className={`connection ${m.status}`}>
                <i />
                {m.statusText}
              </span>
              <span className="room-code">房间 {m.publicCode}</span>
              <Button action="invite" className="text-button">
                <Icon name="link" />
                <span>邀请好友</span>
              </Button>
              {s ? (
                <Button action="home" className="square" aria-label="返回首页">
                  <Icon name="back" />
                </Button>
              ) : (
                <Button action="home" className="text-button">
                  取消连接
                </Button>
              )}
            </>
          ) : (
            <span className="header-note">把朋友聚在一张桌上</span>
          )}
        </div>
        <nav>
          {m.lobbyURL && (
            <a
              className="text-button"
              data-lobby-link=""
              href={m.lobbyURL}
              aria-label="返回游戏大厅"
              title="返回游戏大厅"
            >
              <Icon name="back" />
            </a>
          )}
          <Button action="openQuality" className="text-button" aria-label="画质设置" title="画质设置">
            <Icon name="settings" />
          </Button>
          <Button action="rules" className="text-button" aria-label="玩法指南">
            <Icon name="book" />
            <span>玩法指南</span>
          </Button>
          {!m.domestic && (
            <Button
              action="report"
              className="text-button"
              aria-label="隐私 / 举报"
              title="隐私 / 举报"
            >
              <Icon name="shield" />
            </Button>
          )}
        </nav>
      </header>
      <main
        id="table"
        className={`table ${s ? "in-room playing" : "home"} ${s?.phase === "lobby" ? "waiting" : ""} ${m.task ? "has-required-task" : ""} ${m.panel ? "has-open-panel" : ""}`}
      >
        <aside id="left-panel" />
        <section className="board-area" aria-label="游戏棋盘">
          <div
            id="board"
            aria-busy={m.busy || (Boolean(m.code) && m.status !== "connected")}
          />
          <div className="board-top" id="turn-banner" aria-live="polite">
            {s && <Banner model={room} />}
          </div>
          <section id="action-feedback" aria-label="公开行动反馈" hidden>
            <p
              id="action-feedback-text"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            />
          </section>
          <div className="board-controls">
            <Button
              id="home-motion"
              action="homeMotion"
              hidden={m.homeMotion.hidden}
              disabled={m.homeMotion.disabled}
              aria-label={m.homeMotion.label}
              title={m.homeMotion.label}
              aria-pressed={m.homeMotion.playing}
            >
              <Icon name={m.homeMotion.glyph} />
            </Button>
            <Button action="reset" className="square" aria-label="复位棋盘视角">
              <Icon name="reset" />
            </Button>
            <button
              className="square"
              id="flat-toggle"
              type="button"
              aria-label={m.flat ? "切换三维棋盘" : "切换二维棋盘"}
            >
              {m.flat ? "3D" : "2D"}
            </button>
          </div>
          <div id="tile-hint" className="tile-hint">
            拖动旋转 · 双指或滚轮缩放
          </div>
          <div id="hand">{s && <Hand model={room} />}</div>
          <div id="island-caption">
            {!s?.board && (
              <>
                <strong>卡坦岛</strong>
                <span>从一座村庄开始</span>
              </>
            )}
          </div>
          <svg
            id="action-feedback-leader"
            aria-hidden="true"
            {...{ hidden: "" }}
          >
            <defs>
              <mask id="feedback-line-mask" maskUnits="userSpaceOnUse">
                <rect width="100%" height="100%" fill="white" />
                <g id="feedback-line-cutouts" />
              </mask>
            </defs>
            <path mask="url(#feedback-line-mask)" />
          </svg>
        </section>
        <nav id="stage-tools" aria-label="对局工具">
          {s && <StageTools model={room} />}
        </nav>
        <section id="play-dock" aria-label="建设与回合操作">
          {s &&
            (s.phase === "lobby" ? (
              <LobbyControls model={room} />
            ) : (
              s.board && <GameControls model={room} />
            ))}
        </section>
        <aside id="right-panel" />
        <nav id="player-orbit" aria-label="本桌玩家">
          {s && <PlayerOrbit model={room} />}
        </nav>
        <section id="home-welcome" aria-label="欢迎来到卡坦岛">
          <h1>开拓这座岛</h1>
        </section>
        <nav id="home-dock" aria-label="开始游戏" hidden={Boolean(s)}>
          <Button action="openEntry" className="primary">
            <Icon name="island" />
            <span>开桌 / 加入</span>
          </Button>
          <Button action="homePractice">
            <Icon name="bot" />
            <span>人机练习</span>
          </Button>
          <Button action="openRooms">
            <Icon name="users" />
            <span>在线房间</span>
          </Button>
        </nav>
        <div id="home-safe-area" aria-hidden="true" />
      </main>
      <section id="quality-hint" className="quality-hint" aria-label="画质建议" hidden={!m.qualityHint}>
        <span role="status">画面卡顿，切换省电？</span>
        <Button action="lowerQuality">降低</Button>
        <Button action="keepQuality">保持</Button>
        <Button action="dismissQualityHint" className="square" aria-label="关闭画质建议"><Icon name="close" /></Button>
      </section>
      <dialog id="quality-dialog" aria-labelledby="quality-dialog-title">
        <div className="dialog-heading">
          <h2 id="quality-dialog-title">画质设置</h2>
          <Button action="closeQuality" className="square" aria-label="关闭画质设置"><Icon name="close" /></Button>
        </div>
        <QualityChoice model={m} />
      </dialog>
      <dialog id="stage-dialog" aria-labelledby="stage-dialog-title">
        <div className="dialog-heading">
          <h2 id="stage-dialog-title">{m.stageTitle}</h2>
          <Button
            action="closeStagePanel"
            className="square"
            aria-label="关闭面板"
          >
            <Icon name="close" />
          </Button>
        </div>
        <p id="stage-feedback" role="status" aria-live="polite" />
        <div id="stage-dialog-content">
          {s && m.stagePanel && <StageContent model={room} />}
        </div>
      </dialog>
      <dialog id="room-dialog" aria-labelledby="room-dialog-title">
        <div className="dialog-heading">
          <h2 id="room-dialog-title">{m.confirmation?.title}</h2>
          <Button
            action="cancelRoomDialog"
            className="square"
            aria-label="关闭房间确认"
          >
            <Icon name="close" />
          </Button>
        </div>
        <div id="room-dialog-copy">
          <p>{m.confirmation?.description}</p>
          {m.confirmation?.chooseTransfer && s && (
            <>
              <label htmlFor="transfer-choice">选择在线玩家</label>
              <select id="transfer-choice">
                {s.players
                  .filter((p) => p.id !== s.me && !p.bot && p.online)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </>
          )}
        </div>
        <div className="dialog-actions">
          <Button action="cancelRoomDialog" className="secondary">
            取消
          </Button>
          <Button
            action="confirmRoomDialog"
            className="primary"
            disabled={m.busy}
          >
            {m.confirmation?.confirmText || "确认"}
          </Button>
        </div>
      </dialog>
      <div id="toast" popover="manual" role="status" aria-live="polite" aria-atomic="true" />
      <dialog id="rules-dialog">
        <div className="dialog-heading">
          <h2>玩法规则</h2>
          <Button
            action="closeRules"
            className="square"
            aria-label="关闭玩法指南"
          >
            <Icon name="close" />
          </Button>
        </div>
        <Rules domestic={m.domestic} />
      </dialog>
      {!m.domestic && (
        <dialog id="report-dialog" aria-labelledby="report-title">
          <div className="dialog-heading">
            <h2 id="report-title">隐私 / 举报</h2>
            <Button
              action="closeReport"
              className="square"
              aria-label="关闭举报说明"
            >
              <Icon name="close" />
            </Button>
          </div>
          <div id="report-copy">
            <Report model={m} />
          </div>
        </dialog>
      )}
      <dialog id="practice-dialog" aria-labelledby="practice-title">
        <div className="dialog-heading">
          <h2 id="practice-title">人机练习</h2>
          <Button
            action="closePractice"
            className="square"
            aria-label="关闭练习设置"
          >
            <Icon name="close" />
          </Button>
        </div>
        <form id="practice-form">
          <div id="practice-options">
            <OptionsFields
              prefix="practice"
              options={m.practiceOptions}
              count={m.practiceCount}
            />
          </div>
          <div
            id="practice-seats"
            className="practice-seats"
            aria-live="polite"
          >
            <span>
              <Icon name="users" />你 <b>1</b>
            </span>
            <span aria-hidden="true">+</span>
            <span>
              <Icon name="bot" />
              电脑 <b>{m.practiceCount - 1}</b>
            </span>
          </div>
          <p id="practice-feedback" role="alert" />
          <button
            id="practice-start"
            type="submit"
            className="primary"
            disabled={m.busy}
          >
            <Icon name="bot" />
            开始练习 <Icon name="arrow" />
          </button>
        </form>
      </dialog>
      <dialog id="entry-dialog" aria-labelledby="entry-title">
        <div className="dialog-heading">
          <h2 id="entry-title">开桌 / 加入</h2>
          <Button
            action="closeEntry"
            className="square"
            aria-label="关闭开始游戏"
          >
            <Icon name="close" />
          </Button>
        </div>
        <div id="entry-content">
          <HomePanel model={m} />
        </div>
      </dialog>
      <dialog id="rooms-dialog" aria-label="在线房间">
        <div className="dialog-heading">
          <h2>在线房间</h2>
          <Button
            action="closeRooms"
            className="square"
            aria-label="关闭在线房间"
          >
            <Icon name="close" />
          </Button>
        </div>
        <div id="rooms-content">
          <PublicRooms model={m} />
        </div>
      </dialog>
    </>
  );
}
function Rules({ domestic }: { domestic: boolean }) {
  return (
    <div className="rules-copy">
      <p>
        经典基础版为 3–4 人；5–6 人扩充采用大岛屿与 2025
        配对回合。基础版默认达到 <strong>10 个胜利点</strong>
        获胜。可选拓展在建房时选择，开局前由房主调整，规则对所有人公开。
      </p>
      <h3>先为自己找个好位置</h3>
      <p>
        每人放置两座村庄与两条道路：第一轮顺序放置，第二轮反向放置。第二座村庄会收取相邻地块各
        1 张资源。任意两座村庄之间必须至少隔一个空交叉点。
      </p>
      <h3>掷骰、收获、交易、建造</h3>
      <p>
        掷出两枚骰子，数字对应的地块向相邻村庄生产 1 张资源，向城市生产 2
        张。所有玩家都可能收获。随后可多次交易、建造或购买发展卡，完成后结束回合。
      </p>
      <div className="rules-costs">
        {Object.entries(COSTS).map(([k, c]) => (
          <div key={k}>
            <Icon name={k} />
            <b>
              {
                {
                  road: "道路",
                  settlement: "村庄",
                  city: "城市",
                  development: "发展卡",
                }[k as Build]
              }
            </b>
            {Object.entries(c).map(([r, n]) => (
              <span
                key={r}
                className={`mini-resource ${r}`}
                title={`${LABELS[r as Resource]} ${n}`}
              >
                <Icon name={r} />
                {n}
              </span>
            ))}
          </div>
        ))}
      </div>
      <h3>强盗与七点</h3>
      <p>
        掷出 7 时不生产资源。手牌超过 7
        张的玩家须弃掉一半（向下取整）；当前玩家移动强盗，并从相邻的一名对手处随机抽一张资源。强盗所在格停止生产。
      </p>
      <h3>把资源换成机会</h3>
      <p>
        可向其他玩家提出交易，由对方接受。银行默认 4:1；拥有普通港口时
        3:1，对应专属港口为 2:1。只能在自己的行动阶段主动发起交易。
      </p>
      <h3>发展卡与额外得分</h3>
      <p>
        每回合最多使用一张非胜利点发展卡，当回合购买的不能使用。骑士移动强盗；道路建设免费建造最多两条路；丰收从银行取两张资源；垄断收取所有对手的一种资源。胜利点卡私下自动计分。
      </p>
      <p>
        村庄 1 分，城市 2 分。最长道路至少 5 段、最大骑士军队至少 3 张，各值 2
        分；平手时原持有者保留。对手建筑会截断道路。
      </p>
      <h3>可选拓展（2025 规则）</h3>
      <p>
        <strong>友善强盗：</strong>公开分不超过 2
        分的玩家，其建筑相邻地块不能放置强盗；掷出 7 仍正常弃牌。
        <strong>卡坦港口：</strong>港口村庄计 1 港口分、城市计 2 分，首达 3
        港口分取得 2 胜利分奖励，严格超过现持有者时转交。启用后目标为 11
        胜利分。两项变体均兼容 3–6
        人，按开局实际入座人数自动匹配基础版或人数扩充，之后冻结至本局结束。
      </p>
      <h3>5–6 人扩充 · 2025 配对回合</h3>
      <p>
        每个常规回合由主玩家掷骰并行动，之后由相隔三个座位的配对玩家进行建设阶段：可建造、买与用发展卡、银行及港口交易，不掷骰也不与玩家交易。然后主玩家顺时针轮换。配对玩家也可在自己的建设阶段达到目标分获胜。
      </p>
      <h3>暂离与保留</h3>
      <p>
        普通真人房：房主离线后保留 30 分钟。暂停会停止对局操作和电脑
        {!domestic && "，聊天仍可用"}。主动暂停：本次暂停首次离线后最多 4
        小时，短暂重连不顺延。练习离线保留 10
        分钟，暂停不延长。房主在线时不会因普通闲置关闭。对局中暂离保留身份；等待阶段非房主主动退座释放席位。解散由房主单独确认。
      </p>
    </div>
  );
}
function Report({ model: m }: { model: UIModel }) {
  const info = m.reportInfo;
  if (!info) return <p>正在读取本站配置…</p>;
  if (info.failed) return <p>暂时无法读取举报联系方式，请稍后重新打开。</p>;
  const subject = `卡坦岛举报 · ${m.backendId} · ${m.code ? m.publicCode : "首页"}`,
    body = `线路：${location.origin}\n房间：${m.code ? m.publicCode : "无"}\n${m.reportContext}\n举报原因：\n\n请勿提供恢复凭据、完整手牌或证件。`;
  return (
    <>
      <p>
        举报聊天、昵称或房间问题，可提供线路、房间码、发送者、时间和原因。站长人工核实后可隐藏消息、重置昵称、限制该游戏身份或关闭房间。
      </p>
      {m.reportContext && <p className="report-context">{m.reportContext}</p>}
      <p>
        {info.contact ? (
          <>
            举报邮箱：
            <a
              id="report-mail"
              href={`mailto:${info.contact}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
            >
              {info.contact} · 用邮件举报
            </a>
          </>
        ) : (
          "本站举报联系方式待配置，邮件举报暂不可用。"
        )}
      </p>
      <p className="small muted">
        点击邮箱会打开邮件编辑器，由你确认发送。请勿附恢复凭据、完整手牌或证件。
      </p>
      <p>
        普通聊天仅保留本房间最近 {Number(info.chatLimit) || 100} 条，最长{" "}
        {Number(info.chatDays) || 7} 天，关闭房间后清理。
        {info.retentionDays
          ? `必要处置记录按当前配置保留 ${Number(info.retentionDays)} 天；人工保全项至明确解除。`
          : "处置记录留存期限待配置。"}
        {info.adminReady
          ? "站长处置接口已配置；具体举报由人工核实。"
          : "站长处置接口尚未启用。"}
      </p>
      <p className="small muted">
        以上是当前运行配置，适用备案、留存及处置要求仍需运营者核实。
      </p>
    </>
  );
}
let root: ReturnType<typeof createRoot> | undefined;
/** Commit synchronously before the retained scene and modal adapters measure DOM.
 * This tree is never keyed by server revision: scene, fields and focus stay alive. */
export function renderUI(model: UIModel) {
  flushSync(() => {
    snapshot = model;
    if (!root) root = createRoot(document.getElementById("app")!);
    root.render(<Interface />);
    listeners.forEach((fn) => fn());
  });
}

