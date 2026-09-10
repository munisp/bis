#!/usr/bin/env python3
"""Render an aggregate-only RLS saturation latency chart from a harness JSON summary."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import matplotlib.pyplot as plt


PERCENTILES = ("p50Ms", "p95Ms", "p99Ms", "maxMs")
SERIES = (
    ("poolCheckoutWaitMs", "Pool checkout wait", "#b42318"),
    ("tenantContextSetupMs", "Tenant context setup", "#175cd3"),
    ("workerEndToEndMs", "Worker end-to-end", "#027a48"),
)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: render-rls-saturation-latency-chart.py <saturation-latency-summary.json> <output.png>")

    input_path = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()
    document = json.loads(input_path.read_text(encoding="utf-8"))
    latency = document["latency"]
    queue = document["queue"]

    labels = ["p50", "p95", "p99", "max"]
    figure, (axis, queue_axis) = plt.subplots(
        1,
        2,
        figsize=(14, 6.8),
        gridspec_kw={"width_ratios": [3.1, 1]},
    )
    figure.patch.set_facecolor("#ffffff")

    x_positions = list(range(len(PERCENTILES)))
    width = 0.23
    for offset, (key, label, color) in zip((-width, 0, width), SERIES):
        values = [latency[key][percentile] for percentile in PERCENTILES]
        positions = [position + offset for position in x_positions]
        bars = axis.bar(positions, values, width=width, label=label, color=color)
        for bar, value in zip(bars, values):
            axis.annotate(
                f"{value:.1f}",
                (bar.get_x() + bar.get_width() / 2, bar.get_height()),
                ha="center",
                va="bottom",
                fontsize=8,
                xytext=(0, 3),
                textcoords="offset points",
            )

    axis.set_title("RLS Rotation Worker Latency — 512 Workers / 20-Connection Pool", loc="left", weight="bold")
    axis.set_ylabel("Milliseconds")
    axis.set_xticks(x_positions, labels)
    axis.set_yscale("symlog", linthresh=10)
    axis.grid(axis="y", alpha=0.25)
    axis.set_axisbelow(True)
    axis.legend(frameon=False, loc="upper left")
    axis.text(
        0,
        -0.25,
        "Nearest-rank percentiles. Aggregate synthetic benchmark only; no tenant, PII, ciphertext, or external-service data.",
        transform=axis.transAxes,
        fontsize=8.5,
        color="#475467",
    )

    queue_axis.bar(["Pool cap", "Peak queue"], [queue["configuredPoolMax"], queue["peakObservedPoolWaitingCount"]], color=["#175cd3", "#b42318"])
    queue_axis.set_title("Queue saturation", loc="left", weight="bold")
    queue_axis.set_ylabel("Connections / waiting requests")
    queue_axis.grid(axis="y", alpha=0.25)
    queue_axis.set_axisbelow(True)
    for index, value in enumerate((queue["configuredPoolMax"], queue["peakObservedPoolWaitingCount"])):
        queue_axis.annotate(str(value), (index, value), ha="center", va="bottom", fontsize=9, weight="bold", xytext=(0, 3), textcoords="offset points")
    queue_axis.text(
        0,
        -0.25,
        f"Connection timeout: {queue['configuredConnectionTimeoutMs']:,} ms",
        transform=queue_axis.transAxes,
        fontsize=8.5,
        color="#475467",
    )

    figure.suptitle("Migration 0017 — PostgreSQL tenant RLS dispatch saturation evidence", x=0.07, ha="left", fontsize=14, weight="bold", y=0.99)
    figure.tight_layout(rect=(0, 0.06, 1, 0.95))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    figure.savefig(output_path, dpi=180, bbox_inches="tight")


if __name__ == "__main__":
    main()
