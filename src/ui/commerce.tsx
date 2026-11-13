import type { ReactNode } from "react";
import { RESOURCES, LABELS, total } from "../../shared/board.js";
import { afford, tradeRatio } from "../../shared/game.js";
import {
  buildAvailability,
  buildNames,
  tradeRestriction,
} from "../commerce.js";
import { Button, Icon, ResourceArt, playerStyle } from "./primitives";
import { ownPlayer } from "./types";
import type { Build, Bundle, GameView, Resource, RoomModel } from "./types";

const resources = RESOURCES as Resource[];
const labels = LABELS as Record<Resource, string>;
type TradeSide = "give" | "want";
type Amounts = Partial<Bundle>;

function ResourceBundle({ cards }: { cards: Amounts }) {
  const present = resources.filter((resource) => (cards[resource] || 0) > 0);
  return present.length ? (
    present.map((resource) => (
      <span
        key={resource}
        className={`exchange-resource ${resource}`}
        aria-label={`${labels[resource]} ${cards[resource]} 张`}
      >
        <ResourceArt resource={resource} />
        <b>{cards[resource]}</b>
        <span className="resource-label">{labels[resource]}</span>
      </span>
    ))
  ) : (
    <span className="empty-resource">选资源</span>
  );
}

/** Quantities remain visible even when the surrounding picker already names
 * both sides. The accessible labels always describe the player's perspective. */
function ExchangePreview({
  give,
  want,
  headings = false,
}: {
  give: Amounts;
  want: Amounts;
  headings?: boolean;
}) {
  return (
    <div className="exchange-preview" aria-label="交换预览">
      <div aria-label="你付出">
        {headings && <small>你付出</small>}
        <ResourceBundle cards={give} />
      </div>
      <span aria-hidden="true">→</span>
      <div aria-label="你获得">
        {headings && <small>你获得</small>}
        <ResourceBundle cards={want} />
      </div>
    </div>
  );
}

function TradeTabs({
  items,
  selected,
  view = false,
}: {
  items: [string, string][];
  selected: string;
  view?: boolean;
}) {
  return (
    <div
      className="exchange-tabs"
      role="group"
      aria-label={view ? "交易方式" : "玩家交易视图"}
    >
      {items.map(([id, label]) => (
        <button
          key={id}
          type="button"
          data-trade-view={view ? id : undefined}
          data-trade-page={view ? undefined : id}
          aria-pressed={selected === id}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ResourcePicker({
  side,
  values,
  opposite,
  state,
}: {
  side: TradeSide;
  values: Bundle;
  opposite: Bundle;
  state: GameView;
}) {
  const me = ownPlayer(state),
    direction = side === "give" ? "付出" : "获得";
  return (
    <div className="exchange-resources">
      {resources.map((resource) => {
        const maximum =
          side === "give"
            ? me.hand[resource]
            : state.profile?.resourceCount || 19;
        const count = values[resource],
          blocked = opposite[resource] > 0 || count >= maximum;
        const holding = `持有 ${me.hand[resource]} 张${labels[resource]}`;
        return (
          <div
            key={resource}
            className={`exchange-card ${resource}${count ? " chosen" : ""}`}
          >
            <button
              type="button"
              className="resource-pick"
              data-resource={resource}
              data-side={side}
              data-delta="1"
              aria-label={`增加${direction}${labels[resource]}`}
              title={side === "give" ? holding : `选择获得${labels[resource]}`}
              disabled={blocked}
            >
              <ResourceArt resource={resource} />
              <span className="resource-label">{labels[resource]}</span>
            </button>
            <div className="exchange-stepper">
              <button
                type="button"
                data-resource={resource}
                data-side={side}
                data-delta="-1"
                aria-label={`减少${direction}${labels[resource]}`}
                disabled={!count}
              >
                −
              </button>
              <output aria-label={`${labels[resource]}已选 ${count}`}>
                {count}
              </output>
              <button
                type="button"
                data-resource={resource}
                data-side={side}
                data-delta="1"
                aria-label={`增加${direction}${labels[resource]}`}
                disabled={blocked}
              >
                +
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function bankResource(
  value: string | boolean | undefined,
  fallback: Resource,
): Resource {
  return typeof value === "string" && resources.includes(value as Resource)
    ? (value as Resource)
    : fallback;
}

function BankPicker({
  side,
  selected,
  state,
}: {
  side: TradeSide;
  selected: Resource;
  state: GameView;
}) {
  const me = ownPlayer(state);
  return (
    <div className="exchange-resources bank-choices">
      {resources.map((resource) => {
        const count =
          side === "give" ? me.hand[resource] : state.bank[resource];
        const stock = `${side === "give" ? "持有" : "库存"} ${count} 张${labels[resource]}`;
        return (
          <button
            key={resource}
            type="button"
            className={`exchange-card ${resource}${selected === resource ? " chosen" : ""}`}
            data-bank-side={side}
            data-resource={resource}
            aria-pressed={selected === resource}
            aria-label={`${side === "give" ? "付出" : "获得"}${labels[resource]}，${stock}`}
            title={stock}
          >
            <ResourceArt resource={resource} />
            <span className="resource-label">{labels[resource]}</span>
            <small aria-label={stock}>
              {count || side === "give" ? count : "缺货"}
            </small>
          </button>
        );
      })}
    </div>
  );
}

export function TradePanel({ model }: { model: RoomModel }) {
  const { state, draft, tradeView: view, tradePage: page } = model,
    me = ownPlayer(state);
  const offline = model.busy || model.status !== "connected";
  const give = Object.fromEntries(
    resources.map((resource) => [
      resource,
      Math.min(me.hand[resource], Number(draft.get(`give-${resource}`)) || 0),
    ]),
  ) as Bundle;
  const want = Object.fromEntries(
    resources.map((resource) => [
      resource,
      give[resource] ? 0 : Number(draft.get(`want-${resource}`)) || 0,
    ]),
  ) as Bundle;
  let body: ReactNode;
  if (view === "bank") {
    const from = bankResource(draft.get("bank-give"), "wood"),
      to = bankResource(draft.get("bank-want"), "ore");
    const ratio = tradeRatio(state, state.me, from);
    const reason =
      tradeRestriction(state) ||
      (from === to
        ? "选择两种不同资源"
        : me.hand[from] < ratio
          ? "付款资源不足"
          : !state.bank[to]
            ? "银行暂时缺货"
            : "");
    body = (
      <>
        <div className="exchange-body">
          <h3>
            你付出{" "}
            <small className="rate-source">
              <Icon name={ratio === 4 ? "trade" : "harbor"} />
              {ratio === 4 ? "银行" : ratio === 3 ? "普通港" : "专属港"} {ratio}
              :1
            </small>
          </h3>
          <BankPicker side="give" selected={from} state={state} />
          <h3>你获得</h3>
          <BankPicker side="want" selected={to} state={state} />
        </div>
        <div className="exchange-footer">
          <ExchangePreview give={{ [from]: ratio }} want={{ [to]: 1 }} />
          {reason && (
            <p className="exchange-reason" role="status">
              {reason}
            </p>
          )}
          <Button
            className="primary"
            action="exchangeBank"
            disabled={Boolean(reason) || offline}
          >
            兑换 1 张{labels[to]}
          </Button>
        </div>
      </>
    );
  } else {
    const restriction = tradeRestriction(state, true),
      offer = state.offer,
      isMine = offer?.from === state.me;
    const canCompose =
      state.players[state.turn]?.id === state.me && !restriction;
    let content: ReactNode;
    if (page === "compose") {
      const reason = !canCompose
        ? restriction || "等待你的回合，可查看当前报价"
        : !total(give) || !total(want)
          ? "两边各选至少一种资源"
          : "";
      content = (
        <>
          <div className="exchange-body">
            <h3>你付出</h3>
            <ResourcePicker
              side="give"
              values={give}
              opposite={want}
              state={state}
            />
            <h3>你获得</h3>
            <ResourcePicker
              side="want"
              values={want}
              opposite={give}
              state={state}
            />
          </div>
          <div className="exchange-footer">
            <ExchangePreview give={give} want={want} />
            {reason && (
              <p className="exchange-reason" role="status">
                {reason}
              </p>
            )}
            <Button
              className="primary"
              action="publishTrade"
              disabled={Boolean(reason) || offline}
            >
              {offer ? "发布并替换当前报价" : "发布公开报价"}
            </Button>
          </div>
        </>
      );
    } else if (offer) {
      const reason =
        restriction ||
        (!isMine && !afford(me.hand, offer.want) ? "你的付款资源不足" : "");
      content = (
        <>
          <div className="exchange-body current-offer">
            <h3>
              {isMine
                ? "你发出的报价"
                : `${state.players.find((player) => player.id === offer.from)?.name || "玩家"} 的报价`}
            </h3>
            <ExchangePreview
              give={isMine ? offer.give : offer.want}
              want={isMine ? offer.want : offer.give}
              headings
            />
            <p>{isMine ? "等待其他玩家接受" : "接受后立即成交"}</p>
          </div>
          <div className="exchange-footer">
            <p className="exchange-reason" role="status">
              {reason || "资源未锁定，成交以最新状态为准"}
            </p>
            <Button
              className={isMine ? "secondary" : "primary"}
              action={isMine ? "cancelTrade" : "acceptTrade"}
              data-offer-id={offer.id}
              disabled={Boolean(reason) || offline}
            >
              {isMine ? "撤销报价" : "接受并成交"}
            </Button>
          </div>
        </>
      );
    } else
      content = (
        <div className="exchange-body exchange-empty">
          <Icon name="trade" />
          <p>暂无公开报价</p>
        </div>
      );
    body = (
      <>
        <TradeTabs
          items={[
            ["compose", "发起交易"],
            ["offers", `当前报价${offer ? " · 1" : ""}`],
          ]}
          selected={page}
        />
        {content}
      </>
    );
  }
  return (
    <section className="exchange" aria-label="资源交易">
      <TradeTabs
        items={[
          ["players", "玩家交易"],
          ["bank", "银行／港口"],
        ]}
        selected={view}
        view
      />
      {body}
    </section>
  );
}

export function CostPanel({ model, kind }: { model: RoomModel; kind: Build }) {
  const { state } = model,
    info = buildAvailability(state, kind),
    me = ownPlayer(state),
    shortNames: Record<Resource, string> = { wood: "木", brick: "砖", sheep: "羊", wheat: "麦", ore: "矿" },
    missing = Object.entries(info.cost)
      .filter(([key, value]) => me.hand[key as Resource] < Number(value))
      .map(([key, value]) => `${shortNames[key as Resource]}${Number(value) - me.hand[key as Resource]}`),
    reason = info.reason === "资源不足" ? `缺${missing.join("、")}` : info.reason,
    placing = model.selectedBuild === kind;
  return (
    <section className="build-cost" role="region" aria-label={`${buildNames[kind]}费用`}>
      <div className="cost-summary">
        <strong><Icon name={kind} />{buildNames[kind]}</strong>
        <div className="cost-resources" aria-label="所需资源">
          {info.free ? <span className="cost-free">本次免费</span> : Object.entries(info.cost).map(([key, value]) => {
            const resource = key as Resource, count = Number(value), short = me.hand[resource] < count;
            const label = `${labels[resource]}需要 ${count}，持有 ${me.hand[resource]}${short ? `，差 ${count - me.hand[resource]}` : "，足够"}`;
            return <span key={resource} className={`${resource}${short ? " short" : ""}`} aria-label={label} title={label}>
              <ResourceArt resource={resource} /><b>×{count}</b>
              {short && <small aria-hidden="true">!</small>}
            </span>;
          })}
        </div>
      </div>
      <p role="status" title={reason || undefined}>
        {reason || (kind === "development" ? "确认费用后购买" : "点亮起位置建造 · 点空白收起")}
      </p>
      {kind === "development" && <Button className="primary cost-buy" action="buyDevelopment" disabled={!info.can || model.busy || model.status !== "connected"}>购买</Button>}
      <Button className="cost-dismiss" action="closeCost" aria-label={placing ? "取消建造" : "关闭费用"}>
        {placing ? "取消" : "关闭"}
      </Button>
    </section>
  );
}

export function AwardPanel({ state }: { state: GameView }) {
  const awards: {
    key: "longest" | "army" | "harbormaster";
    glyph: string;
    label: string;
    stat: "roadLength" | "knights" | "harborPoints";
    minimum: number;
  }[] = [
    {
      key: "longest",
      glyph: "road",
      label: "最长道路",
      stat: "roadLength",
      minimum: 5,
    },
    {
      key: "army",
      glyph: "knight",
      label: "最大军队",
      stat: "knights",
      minimum: 3,
    },
  ];
  if (state.options?.harbormaster)
    awards.push({
      key: "harbormaster",
      glyph: "harbor",
      label: "卡坦港口",
      stat: "harborPoints",
      minimum: 3,
    });
  return (
    <div className="award-progress">
      {awards.map(({ key, glyph, label, stat, minimum }) => {
        const holder = state.players.find((player) => player.id === state[key]);
        return (
          <section key={key}>
            <h3>
              <Icon name={glyph} />
              {label}
              <b>+2 分</b>
            </h3>
            <p>{holder ? `${holder.name} 持有` : `待获得 · 门槛 ${minimum}`}</p>
            <div>
              {state.players.map((player) => (
                <span
                  key={player.id}
                  style={playerStyle(player.color)}
                  className={state[key] === player.id ? "award-holder" : ""}
                >
                  {player.name} <b>{player[stat] || 0}</b> / {minimum}
                </span>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
