export type ChartSample = { time: string; value: number };

export function chartPoints(
  samples: ChartSample[],
  width: number,
  height: number,
  minimum: number,
  maximum: number,
) {
  const range = Math.max(1, maximum - minimum);
  return samples.map((sample) => ({
    x: (Number(sample.time.slice(11, 13)) / 23) * width,
    y: height - ((sample.value - minimum) / range) * height,
  }));
}

// Monotone cubic interpolation keeps the line within measured hourly extrema.
export function drawWeatherChart(
  context: OffscreenCanvasRenderingContext2D,
  samples: ChartSample[],
  width: number,
  height: number,
  minimum: number,
  maximum: number,
) {
  context.clearRect(0, 0, width, height);
  const points = chartPoints(samples, width, height, minimum, maximum);
  if (!points.length) return;
  const slopes = points
    .slice(1)
    .map(
      (point, index) =>
        (point.y - points[index].y) / Math.max(1, point.x - points[index].x),
    );
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0] ?? 0;
    if (index === points.length - 1) return slopes[index - 1] ?? 0;
    const a = slopes[index - 1],
      b = slopes[index];
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  });
  const line = () => {
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1],
        point = points[index];
      const step = (point.x - previous.x) / 3;
      context.bezierCurveTo(
        previous.x + step,
        previous.y + tangents[index - 1] * step,
        point.x - step,
        point.y - tangents[index] * step,
        point.x,
        point.y,
      );
    }
  };
  context.beginPath();
  line();
  context.lineTo(points.at(-1)!.x, height);
  context.lineTo(points[0].x, height);
  context.closePath();
  const fill = context.createLinearGradient(0, 0, 0, height);
  fill.addColorStop(0, "#ffcf5a55");
  fill.addColorStop(1, "#ffcf5a03");
  context.fillStyle = fill;
  context.fill();
  context.beginPath();
  line();
  context.strokeStyle = "#ffd15b";
  context.lineWidth = 3;
  context.lineCap = "round";
  context.stroke();
}
