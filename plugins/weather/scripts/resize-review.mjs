// Development-only frame pacing probe around the released sandbox surface.
// This measures parent animation-frame intervals, not GPU presentation timestamps.
export function installResizeReview(stage, variant) {
  const panel = document.createElement("section");
  panel.setAttribute("aria-label", "Resize performance review");
  panel.style.cssText =
    "height:70px;box-sizing:border-box;padding:8px 12px;color:white;font:12px system-ui;background:#162b3d";
  const button = document.createElement("button");
  button.textContent = "Run resize sweep";
  const output = document.createElement("output");
  output.setAttribute("aria-live", "polite");
  output.style.cssText = "display:block;margin-top:6px";
  output.textContent = variant + ": ready";
  panel.append(button, output);
  document.body.prepend(panel);
  stage.style.height = "calc(100vh - 70px)";
  button.addEventListener("click", async () => {
    button.disabled = true;
    output.textContent = variant + ": measuring 240 resize frames…";
    const maximum = document.documentElement.clientWidth;
    const minimum = Math.min(640, maximum * 0.6);
    const intervals = [];
    let previous;
    // Two warm-up frames precede four equal-width contraction/expansion cycles.
    for (let frame = -2; frame < 240; frame += 1) {
      const now = await new Promise(requestAnimationFrame);
      if (frame >= 0 && previous !== undefined) intervals.push(now - previous);
      previous = now;
      const phase = (Math.max(0, frame) % 60) / 60;
      const width =
        maximum - (maximum - minimum) * (1 - Math.abs(phase * 2 - 1));
      stage.style.width = Math.round(width) + "px";
    }
    stage.style.width = "";
    const sorted = [...intervals].sort((a, b) => a - b);
    const elapsed = intervals.reduce((sum, value) => sum + value, 0);
    const result = {
      variant,
      viewport: maximum + "×" + document.documentElement.clientHeight,
      frames: intervals.length,
      elapsed_ms: Math.round(elapsed),
      mean_ms: +(elapsed / intervals.length).toFixed(1),
      p95_ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
      over_33ms: intervals.filter((value) => value > 33.4).length,
    };
    output.textContent = JSON.stringify(result);
    button.disabled = false;
  });
}
