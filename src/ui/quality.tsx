import type { UIModel } from "./types";
export function QualityChoice({model:m,id="graphics-quality"}:{model:UIModel,id?:string}) {
  return <fieldset className="quality-choice">
    <legend>3D 画质</legend>
    <label htmlFor={id}>画面效果</label>
    <select id={id} data-graphics-quality="" value={m.graphicsQuality} onChange={()=>{}}>
      <option value="high">高画质（默认）</option>
      <option value="low">省电</option>
    </select>
    <p>高画质保留完整光影；省电减少实时阴影、天空细节和局部灯光。仅影响这台设备，可随时改回。</p>
  </fieldset>;
}
