import { Show } from "solid-js";
import { conditionForCode } from "./weather-model";

export function WeatherIcon(props: { code: number; day?: boolean; label: string }) {
  return <span class={"weather-icon icon-" + conditionForCode(props.code, props.day ?? true).kind + (props.day === false ? " icon-night" : "")}
    role="img" aria-label={props.label}>
    <span class="icon-sun" /><span class="icon-cloud" /><span class="icon-drops" />
  </span>;
}

// Illustrations summarize the same measurements displayed by the metric card.
export function MetricIllustration(props: { id: string; humidity: number; direction?: number | null;
  uv?: number | null; pressure?: number | null; sunProgress: number; compassLabels: string[] }) {
  return <span class={"metric-illustration illustration-" + props.id} aria-hidden="true">
    <Show when={props.id === "wind" && props.direction != null}>
      <svg viewBox="0 0 100 100" class="compass"><circle cx="50" cy="50" r="36" class="dial-ticks" />
        <text x="50" y="16">{props.compassLabels[0]}</text><text x="87" y="54">{props.compassLabels[1]}</text>
        <text x="50" y="92">{props.compassLabels[2]}</text><text x="13" y="54">{props.compassLabels[3]}</text>
        <g transform={"rotate(" + props.direction + " 50 50)"}><path d="M50 22 L45 39 L55 39 Z" class="needle-tip" /><path d="M50 37V78" class="needle" /></g>
        <circle cx="50" cy="50" r="4" class="needle-hub" />
      </svg>
    </Show>
    <Show when={props.id === "sunset"}>
      <svg viewBox="0 0 160 55" class="sun-arc"><path d="M8 49H152" class="horizon" />
        <path d="M15 49Q80 -30 145 49" class="sun-orbit" />
        <circle cx={15 + 130 * props.sunProgress} cy={49 - 158 * props.sunProgress * (1 - props.sunProgress)} r="5" class="sun-position" />
      </svg>
    </Show>
    <Show when={props.id === "uv" || props.id === "humidity"}>
      <span class={props.id === "uv" ? "uv-scale" : "humidity-scale"}
        style={{ "--level": Math.max(0, Math.min(100, props.id === "uv" ? (props.uv ?? 0) / 11 * 100 : props.humidity)) + "%" }} />
    </Show>
    <Show when={props.id === "rain"}>
      <svg viewBox="0 0 160 50" class="rain-illustration"><path d="M80 3C73 15 66 22 66 31a14 14 0 0028 0C94 22 87 15 80 3Z" /><path d="M52 11C48 19 43 24 43 30a9 9 0 0018 0C61 24 56 19 52 11Z" /><path d="M108 11C104 19 99 24 99 30a9 9 0 0018 0C117 24 112 19 108 11Z" /></svg>
    </Show>
    <Show when={props.id === "feels-like"}>
      <svg viewBox="0 0 160 50" class="feels-illustration"><path d="M64 38H145M15 38H48" class="horizon" /><path d="M53 29V8a5 5 0 0110 0v21a10 10 0 11-10 0Z" /><path d="M58 13v24" class="mercury" /><circle cx="58" cy="37" r="4" class="mercury-bulb" /><path d="M82 14h32M82 22h22M82 30h40" class="horizon" /></svg>
    </Show>
    <Show when={props.id === "visibility"}>
      <svg viewBox="0 0 160 50" class="visibility-illustration"><path d="M5 44L40 12L64 35L86 19L119 44M75 44L118 6L155 44" /><path d="M7 44H153" class="horizon" /></svg>
    </Show>
    <Show when={props.id === "pressure"}>
      <svg viewBox="0 0 160 55" class="pressure-illustration"><path d="M38 50a42 42 0 0184 0" class="dial-ticks" /><g transform={"rotate(" + Math.max(-70, Math.min(70, ((props.pressure ?? 1013) - 1013) * 2)) + " 80 50)"}><path d="M80 50V19" class="needle" /></g><circle cx="80" cy="50" r="4" class="needle-hub" /></svg>
    </Show>
  </span>;
}
