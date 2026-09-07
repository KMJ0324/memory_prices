"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { DataZoomComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { colorFor } from "@/lib/tickers";
import { formatValue, type Mode } from "@/lib/normalize";
import type { Series } from "@/lib/types";

echarts.use([LineChart, GridComponent, TooltipComponent, DataZoomComponent, CanvasRenderer]);

type AxisGroup = "chip" | "krw" | "usd";

/** Which y-axis a series belongs to when actual prices (not indexes) are shown. */
function axisGroup(s: Series): AxisGroup {
  if (s.kind === "memory") return "chip";
  return s.currency === "KRW" ? "krw" : "usd";
}

const AXIS_LABEL: Record<AxisGroup, string> = {
  chip: "현물가 (USD)",
  krw: "주가 (원)",
  usd: "주가 (USD)",
};

interface Props {
  series: Series[];
  mode: Mode;
}

export default function Chart({ series, mode }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, null, { renderer: "canvas" });
    instance.current = chart;
    const onResize = () => chart.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.dispose();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = instance.current;
    if (!chart) return;

    // In normalized mode everything shares one index axis; in actual mode each
    // currency/unit gets its own, otherwise a 70,000원 line flattens a $3 line.
    const groups: AxisGroup[] =
      mode === "normalized"
        ? []
        : (["chip", "krw", "usd"] as AxisGroup[]).filter((g) => series.some((s) => axisGroup(s) === g));

    const yAxis =
      mode === "normalized"
        ? [
            {
              type: "value" as const,
              name: "기준일 = 100",
              nameTextStyle: { color: "#8b93a7" },
              scale: true,
              axisLabel: { color: "#8b93a7" },
              splitLine: { lineStyle: { color: "#232838" } },
            },
          ]
        : groups.map((g, i) => ({
            type: "value" as const,
            name: AXIS_LABEL[g],
            nameTextStyle: { color: "#8b93a7" },
            position: i === 0 ? ("left" as const) : ("right" as const),
            offset: i <= 1 ? 0 : (i - 1) * 62,
            scale: true,
            axisLabel: {
              color: "#8b93a7",
              formatter: (v: number) =>
                g === "krw" ? `${Math.round(v / 1000)}k` : `${v}`,
            },
            splitLine: { show: i === 0, lineStyle: { color: "#232838" } },
          }));

    const chartSeries = series.map((s) => ({
      name: s.label,
      type: "line" as const,
      yAxisIndex: mode === "normalized" ? 0 : Math.max(0, groups.indexOf(axisGroup(s))),
      // 수집 초기에는 점이 몇 개뿐이라 선만으로는 아무것도 안 보인다.
      showSymbol: s.points.length < 60,
      symbolSize: 5,
      smooth: false,
      // Unverified spot data is drawn dashed so it never reads as a real quote.
      lineStyle: {
        width: s.kind === "memory" ? 2.4 : 1.6,
        type: s.source === "PLACEHOLDER" ? ("dashed" as const) : ("solid" as const),
      },
      color: colorFor(s),
      data: s.points.map((p) => [p.date, p.value] as [string, number]),
    }));

    const byLabel = new Map(series.map((s) => [s.label, s]));

    chart.setOption(
      {
        backgroundColor: "transparent",
        animationDuration: 300,
        // Series names live in the toggle chips above the chart, so ECharts'
        // own legend would just duplicate them.
        grid: { left: 58, right: 58 + Math.max(0, groups.length - 2) * 62, top: 34, bottom: 78 },
        tooltip: {
          trigger: "axis",
          backgroundColor: "#151925",
          borderColor: "#2c3346",
          textStyle: { color: "#e6e9f2" },
          axisPointer: { type: "line", lineStyle: { color: "#3a4157" } },
          formatter: (params: unknown) => {
            const list = (Array.isArray(params) ? params : [params]) as Array<{
              seriesName: string;
              value: [string, number];
              color: string;
            }>;
            if (list.length === 0) return "";
            const head = `<div style="margin-bottom:6px;font-weight:600">${list[0].value[0]}</div>`;
            const rows = list
              .map((p) => {
                const s = byLabel.get(p.seriesName);
                const text = s ? formatValue(p.value[1], s, mode) : String(p.value[1]);
                return (
                  `<div style="display:flex;gap:8px;align-items:center;justify-content:space-between">` +
                  `<span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${p.color};margin-right:6px"></span>${p.seriesName}</span>` +
                  `<b>${text}</b></div>`
                );
              })
              .join("");
            return head + rows;
          },
        },
        xAxis: {
          type: "time",
          axisLabel: { color: "#8b93a7" },
          axisLine: { lineStyle: { color: "#2c3346" } },
          splitLine: { show: false },
        },
        yAxis,
        dataZoom: [
          { type: "inside", throttle: 50 },
          {
            type: "slider",
            height: 26,
            bottom: 22,
            borderColor: "#2c3346",
            backgroundColor: "#12151f",
            fillerColor: "rgba(76,141,255,0.14)",
            handleStyle: { color: "#4c8dff" },
            textStyle: { color: "#8b93a7" },
          },
        ],
        series: chartSeries,
      },
      { replaceMerge: ["series", "yAxis"] },
    );
  }, [series, mode]);

  return <div ref={ref} className="chart" role="img" aria-label="DRAM/NAND 현물가와 메모리 반도체 종목 주가 비교 차트" />;
}
