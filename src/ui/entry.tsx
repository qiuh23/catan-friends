import { rulesLabel, roomAvailability, variantOptions } from "../room-ui.js";
import { Button, Icon, initial, playerStyle } from "./primitives";
import { AwardPanel } from "./commerce";
import { ownPlayer, type Options, type RoomModel, type UIModel } from "./types";

const displayCode = (model: UIModel, code: string) =>
  model.backendId === "aliyun"
    ? `A-${code}`
    : model.backendId === "cloudflare"
      ? `C-${code}`
      : code;

export function OptionsFields({
  prefix,
  options = {},
  count = options.playerExpansion === "five-six-2025" ? 6 : 4,
}: {
  prefix: string;
  options?: Options;
  count?: number;
}) {
  return (
    <>
      {prefix === "practice" && (
        <fieldset className="count-options">
          <legend>总人数</legend>
          <div className="count-buttons">
            {[3, 4, 5, 6].map((n) => (
              <label key={n} htmlFor={`${prefix}-count-${n}`}>
                <input
                  id={`${prefix}-count-${n}`}
                  name={`${prefix}-count`}
                  data-persist=""
                  type="radio"
                  value={n}
                  defaultChecked={n === count}
                />
                <span>
                  <b>{n}</b> 人
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <p
        id={`${prefix}-rule-summary`}
        className="rule-match"
        aria-live="polite"
      />
      <fieldset className="rules-options">
        <legend>拓展规则</legend>
        <div className="variant-cards">
          {variantOptions.map((v) => (
            <label
              key={v.key}
              className="variant-card"
              htmlFor={`${prefix}-${v.key}`}
              title={v.description}
            >
              <input
                id={`${prefix}-${v.key}`}
                data-persist=""
                type="checkbox"
                defaultChecked={Boolean(options[v.key as keyof Options])}
              />
              <Icon name={v.glyph} />
              <span>
                <b>{v.name}</b>
              </span>
              <Icon name="check" />
            </label>
          ))}
        </div>
      </fieldset>
      <p
        id={`${prefix}-compatibility`}
        className="rule-compatibility"
        role="alert"
        hidden
      />
    </>
  );
}

export function HomePanel({ model }: { model: UIModel }) {
  const disabled = model.busy || Boolean(model.entryError);
  return (
    <>
      {model.entryError && (
        <p className="entry-error" role="alert">
          {model.entryError} <a href="/">返回当前服务器首页</a>
        </p>
      )}
      {model.terminalMessage && (
        <p className="room-outcome" role="status">
          {model.terminalMessage}
        </p>
      )}
      <div className="home-intro">
        <h1>一起，开拓这座岛。</h1>
        <p>收获 · 交易 · 建设</p>
      </div>
      <form id="entry-form">
        {model.domestic ? (
          <>
            <label>你的随机昵称</label>
            <div className="fixed-nickname">
              <strong id="fixed-nickname">{model.nickname?.name}</strong>
              <Button
                action="newNickname"
                disabled={Boolean(model.code) || disabled}
                className="secondary"
              >
                换一个
              </Button>
            </div>
          </>
        ) : (
          <>
            <label htmlFor="nickname">你的昵称</label>
            <input
              id="nickname"
              data-persist=""
              autoComplete="nickname"
              maxLength={16}
              placeholder="怎么称呼你"
              defaultValue={model.name}
              required
            />
          </>
        )}
        <div className="join-row">
          <input
            id="join-code"
            data-persist=""
            aria-label="6 位房间码或带本站前缀的邀请码"
            autoComplete="off"
            maxLength={8}
            placeholder={
              model.backendId === "aliyun"
                ? "房间码 / A-前缀"
                : model.backendId === "cloudflare"
                  ? "房间码 / C-前缀"
                  : "6 位房间码"
            }
            defaultValue={model.invite ? displayCode(model, model.invite) : ""}
          />
          <button type="submit" disabled={disabled}>
            加入房间
          </button>
        </div>
        <div className="create-heading">
          <h2>开一桌</h2>
          <select
            id="create-visibility"
            data-persist=""
            aria-label="房间可见性"
            defaultValue="public"
          >
            <option value="public">公开房</option>
            <option value="private">私密房</option>
          </select>
        </div>
        <section className="create-options" aria-label="人数与拓展规则">
          <OptionsFields prefix="create" />
        </section>
        <button
          type="button"
          id="create-room"
          className="primary large"
          disabled={disabled}
        >
          {model.busy ? "正在准备岛屿…" : "创建好友房间"}
          <Icon name="arrow" />
        </button>
      </form>
      <div className="practice-entry">
        <Button action="practice" disabled={disabled} className="secondary">
          <Icon name="bot" />
          人机练习
        </Button>
      </div>
      {model.last && (
        <Button action="resume" disabled={disabled} className="resume-button">
          原身份返回 {displayCode(model, model.last.code)} <Icon name="arrow" />
        </Button>
      )}
      <div className="home-bottom">
        <a
          href="https://github.com/Jack15678/catan-friends"
          target="_blank"
          rel="noopener noreferrer"
        >
          原作 Jack15678 · 个人非商业娱乐
        </a>
      </div>
    </>
  );
}

export function PublicRooms({ model }: { model: UIModel }) {
  const list = model.roomList;
  return (
    <section className="public-rooms" aria-labelledby="public-rooms-title">
      <div className="panel-heading">
        <h2 id="public-rooms-title">在线房间</h2>
        <Button
          className="square"
          action="refreshRooms"
          aria-label="刷新在线房间"
          title="刷新在线房间"
          disabled={list.status === "loading" || Boolean(model.entryError)}
        >
          <Icon name="reset" />
        </Button>
      </div>
      <div
        id="public-room-results"
        aria-live="polite"
        aria-busy={list.status === "loading"}
      >
        {list.status === "loading" ? (
          <p className="list-message">正在加载…</p>
        ) : list.status === "error" ? (
          <>
            <p className="list-message list-error" role="alert">
              连接失败：{list.error}
            </p>
            <Button action="refreshRooms" className="secondary">
              重试
            </Button>
          </>
        ) : !list.rooms.length ? (
          <p className="list-message">暂无公开房间</p>
        ) : (
          list.rooms.map((room) => {
            const canReturn = model.returnableRooms.includes(room.code),
              availability = roomAvailability(room, canReturn);
            const label =
              room.phase === "finished"
                ? "已结束"
                : room.status === "paused"
                  ? "已暂停"
                  : room.phase !== "lobby"
                    ? "进行中"
                    : room.playerCount >= room.maxPlayers
                      ? "已满"
                      : "等待入座";
            return (
              <article className="public-room" key={room.code}>
                <div className="room-identity">
                  <strong>{displayCode(model, room.code)}</strong>
                  <span
                    className={`room-status ${room.phase === "lobby" ? "waiting" : ""}`}
                  >
                    {label}
                  </span>
                </div>
                <div className="room-facts">
                  <span
                    className="room-host"
                    title={`房主 ${room.hostName}`}
                    aria-label={`房主 ${room.hostName}`}
                  >
                    <Icon name="flag" />
                    <span>{room.hostName}</span>
                  </span>
                  <span
                    className="room-count"
                    aria-label={`${room.playerCount} 人，最多 ${room.maxPlayers} 人`}
                  >
                    <Icon name="users" />
                    <b>
                      {room.playerCount}/{room.maxPlayers}
                    </b>
                  </span>
                </div>
                <div
                  className="room-variants"
                  aria-label={rulesLabel(room.options)}
                >
                  <span>
                    {room.options?.playerExpansion === "five-six-2025"
                      ? "5–6 人扩充"
                      : "基础版"}
                  </span>
                  {variantOptions
                    .filter((v) => room.options?.[v.key as keyof Options])
                    .map((v) => (
                      <span key={v.key} title={v.name}>
                        <Icon name={v.glyph} />
                        {v.name}
                      </span>
                    ))}
                </div>
                <button
                  type="button"
                  className={canReturn ? "secondary" : "primary"}
                  data-list-room={room.code}
                  aria-label={
                    availability.label === "加入房间"
                      ? `加入房间 ${displayCode(model, room.code)}`
                      : availability.label
                  }
                  disabled={availability.disabled || Boolean(model.entryError)}
                >
                  {availability.label === "加入房间"
                    ? "加入"
                    : availability.label}
                </button>
              </article>
            );
          })
        )}
      </div>
      {list.moreError && (
        <p className="list-message list-error" role="alert">
          {list.moreError}，已加载的房间仍保留。
        </p>
      )}
      {list.nextCursor && (
        <Button
          action="loadMoreRooms"
          disabled={list.moreStatus === "loading" || list.status === "loading"}
          className="load-more secondary"
        >
          {list.moreStatus === "loading"
            ? "正在加载…"
            : list.moreError
              ? "重试加载更多"
              : "加载更多"}
        </Button>
      )}
    </section>
  );
}

export function RoomSettings({ model }: { model: RoomModel }) {
  const s = model.state;
  return (
    <section className="room-settings">
      <div className="panel-heading">
        <h2>{model.isHost ? "房间设置" : "本桌规则"}</h2>
        <Button action="rules" className="text-button">
          <Icon name="book" />
          规则
        </Button>
      </div>
      {model.isHost ? (
        <form id="room-settings-form">
          <label htmlFor="room-visibility">房间可见性</label>
          <select
            id="room-visibility"
            data-persist=""
            defaultValue={
              s.room?.visibility === "private" ? "private" : "public"
            }
          >
            <option value="public">公开 · 在线列表可见</option>
            <option value="private">私密 · 邀请码加入</option>
          </select>
          <OptionsFields prefix="room" options={s.options} />
          <button
            type="submit"
            className="secondary"
            disabled={model.busy || model.status !== "connected"}
          >
            保存规则 · 重新准备
          </button>
        </form>
      ) : (
        <p className="rules-summary">
          {rulesLabel(s.options)} · {s.targetPoints || 10} 分
        </p>
      )}
    </section>
  );
}

export function PlayerList({ model }: { model: RoomModel }) {
  const s = model.state,
    hostId = s.room?.hostId || s.players[0]?.id;
  return (
    <div className="players">
      {s.players.map((p, i) => (
        <div
          key={p.id}
          className={`player ${s.phase !== "lobby" && i === s.turn ? "active" : ""} ${p.id === s.me ? "self" : ""}`}
        >
          <span className="avatar" style={playerStyle(p.color)}>
            {p.bot ? <Icon name="bot" /> : initial(p.name, model.domestic)}
          </span>
          <div className="player-info">
            <strong>
              {p.name}
              {p.nicknameBadge ? <small>#{p.nicknameBadge}</small> : null}
              {model.domestic && p.bot && <small>电脑</small>}
              {p.id === s.me && <small>你</small>}
              {p.id === hostId && <small>房主</small>}
            </strong>
            {s.phase === "lobby" ? (
              <span>
                {p.bot
                  ? "电脑已准备"
                  : p.id === hostId
                    ? "主持开局"
                    : p.ready
                      ? "已准备"
                      : "未准备"}
                {!p.online && " · 离线"}
              </span>
            ) : (
              <div className="player-stats">
                <span aria-label={`${p.cards} 张资源`} title="资源牌">
                  <Icon name="cards" />
                  <b>{p.cards}</b>
                </span>
                <span
                  aria-label={`${p.developmentCount} 张发展卡`}
                  title="发展卡"
                >
                  <Icon name="development" />
                  <b>{p.developmentCount}</b>
                </span>
                {s.options?.harbormaster && (
                  <span
                    aria-label={`港口分 ${p.harborPoints || 0}`}
                    title="港口分"
                  >
                    <Icon name="harbor" />
                    <b>{p.harborPoints || 0}</b>
                  </span>
                )}
                {!p.online && (
                  <span className="player-offline">
                    <Icon name="offline" />
                    离线
                  </span>
                )}
                {i === s.turn && (
                  <span className="player-turn">
                    <Icon name="arrow" />
                    行动中
                  </span>
                )}
              </div>
            )}
          </div>
          {s.phase === "lobby" ? (
            model.isHost && p.id !== s.me ? (
              <div className="player-management">
                {p.bot ? (
                  <button
                    type="button"
                    className="remove-bot"
                    data-remove-bot={p.id}
                    aria-label={`移除电脑 ${p.name}`}
                  >
                    ×
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      data-transfer={p.id}
                      aria-label={`转交房主给 ${p.name}`}
                      disabled={!p.online}
                    >
                      转交
                    </button>
                    <button
                      type="button"
                      data-kick={p.id}
                      aria-label={`移出玩家 ${p.name}`}
                    >
                      移出
                    </button>
                  </>
                )}
              </div>
            ) : (
              <span className={`presence ${p.online ? "online" : ""}`} />
            )
          ) : (
            <div className="score" aria-label={`${p.points} 分`}>
              <b>{p.points}</b>
              <small>分</small>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function LobbyControls({ model }: { model: RoomModel }) {
  const s = model.state,
    disabled = model.busy || model.status !== "connected",
    unready = s.players.some(
      (p) => !p.bot && p.id !== s.me && (!p.ready || !p.online),
    );
  return (
    <div className="waiting-actions">
      <Button action="invite" className="secondary">
        <Icon name="link" />
        <span>邀请</span>
      </Button>
      {model.isHost && (
        <Button
          action="addBot"
          disabled={disabled || s.players.length >= 6}
          className="secondary"
        >
          <Icon name="bot" />
          <span>加电脑</span>
        </Button>
      )}
      <Button action="openSettings" className="secondary">
        <Icon name="settings" />
        <span>玩法</span>
      </Button>
      {model.isHost ? (
        <Button
          action="start"
          disabled={disabled || s.players.length < 3 || unready}
          className="primary"
        >
          开始探索 <Icon name="arrow" />
        </Button>
      ) : (
        <Button action="ready" disabled={disabled} className="primary">
          {ownPlayer(s).ready ? (
            <>
              <Icon name="check" />
              已准备
            </>
          ) : (
            "准备好了"
          )}
        </Button>
      )}
    </div>
  );
}

export function PlayerOrbit({ model }: { model: RoomModel }) {
  const s = model.state,
    hostId = s.room?.hostId || s.players[0]?.id;
  return (
    <>
      {s.players.map((p, i) => {
        const active = s.phase !== "lobby" && i === s.turn;
        const ready = p.bot || p.ready || p.id === hostId;
        const description = `${p.name}${p.nicknameBadge ? `，编号${p.nicknameBadge}` : ""}${model.domestic && p.bot ? "，电脑" : ""}${p.id === s.me ? "，你" : ""}，${s.phase === "lobby" ? (p.id === hostId ? "房主" : p.bot || p.ready ? "已准备" : "等待准备") : `${p.points} 分`}${active ? "，当前行动者" : ""}${!p.online ? "，离线" : ""}`;
        return (
          <button
            key={p.id}
            type="button"
            data-player={p.id}
            className={`player-circle ${p.id === s.me ? "self" : ""} ${!p.online ? "offline" : ""}`}
            style={playerStyle(p.color)}
            aria-current={active}
            aria-label={description}
            title={`${p.name}${active ? " · 行动中" : ""}`}
            aria-haspopup="dialog"
          >
            <span className="circle-face">
              {model.domestic ? (
                p.name
              ) : p.bot ? (
                <Icon name="bot" />
              ) : (
                initial(p.name, false)
              )}
            </span>
            {model.domestic && p.bot && (
              <span className="circle-bot">电脑</span>
            )}
            <span className="circle-score">
              {s.phase === "lobby" ? (
                ready ? (
                  <Icon name="check" />
                ) : (
                  "…"
                )
              ) : (
                p.points
              )}
            </span>
            {active && (
              <span className="circle-turn" aria-hidden="true">
                <Icon name="arrow" />
              </span>
            )}
            {p.id === s.me && <span className="circle-self">你</span>}
            {!p.online && (
              <span className="circle-offline" aria-hidden="true">
                <Icon name="offline" />
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

export function GamePanel({ model }: { model: RoomModel }) {
  return (
    <>
      <div className="game-goal">
        <Icon name="trophy" />
        <strong>{model.state.targetPoints || 10}</strong>
        <span>分获胜</span>
        <small>
          {model.state.options?.playerExpansion === "five-six-2025"
            ? "配对回合"
            : "基础规则"}
        </small>
      </div>
      <div className="player-stat-legend">
        <Icon name="cards" />
        资源 <Icon name="development" />
        发展卡
        {model.state.options?.harbormaster && (
          <>
            <Icon name="harbor" />
            港口分
          </>
        )}
      </div>
      <PlayerList model={model} />
      <AwardPanel state={model.state} />
    </>
  );
}

export function PlayerDetail({ model }: { model: RoomModel }) {
  const s = model.state,
    p = s.players.find((p) => p.id === model.focusedPlayer);
  if (!p) return <GamePanel model={model} />;
  return (
    <section className="player-detail">
      <div className="detail-avatar" style={playerStyle(p.color)}>
        {p.bot ? (
          <Icon name="bot" />
        ) : model.domestic ? (
          [...p.name][0]
        ) : (
          initial(p.name, false)
        )}
      </div>
      <h3>
        {p.name} {p.id === s.me && <small>你</small>}
      </h3>
      <p>
        {s.players[s.turn]?.id === p.id && "当前行动者 · "}
        {p.online ? "在线" : "离线"}
        {p.bot && " · 电脑"}
      </p>
      <div className="public-stats">
        <span>
          <Icon name="trophy" />
          <b>{p.points}</b> 分
        </span>
        <span>
          <Icon name="cards" />
          <b>{p.cards}</b> 资源牌
        </span>
        <span>
          <Icon name="development" />
          <b>{p.developmentCount}</b> 发展卡
        </span>
        <span>
          <Icon name="knight" />
          <b>{p.knights || 0}</b> 骑士
        </span>
      </div>
      <Button action="allPlayers" className="secondary">
        <Icon name="users" />
        全部玩家与奖项
      </Button>
    </section>
  );
}

export function ResultPanel({ model }: { model: RoomModel }) {
  const s = model.state,
    winner = s.players.find((p) => p.id === s.winner),
    ranked = [...s.players].sort((a, b) => b.points - a.points);
  return (
    <section className="winner">
      <Icon name="flag" />
      <h2>{winner?.name} 获胜</h2>
      <p>{winner?.points} 个胜利点</p>
      <div className="result-actions">
        {model.isHost && (
          <Button action="rematch" disabled={model.busy} className="primary">
            再来一局
          </Button>
        )}
        <Button action="home" className="secondary">
          返回首页
        </Button>
        {model.lobbyURL && (
          <a className="secondary" data-lobby-link="" href={model.lobbyURL}>
            返回游戏大厅
          </a>
        )}
      </div>
      <ol className="result-ranking" aria-label="本局最终成绩">
        {ranked.map((p) => (
          <li key={p.id} style={playerStyle(p.color)}>
            <span>
              {p.name}
              {p.id === s.me && <small> · 你</small>}
            </span>
            <strong>{p.points} 分</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}
